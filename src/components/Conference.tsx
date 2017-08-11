import * as React from 'react';

import {
    ConferenceConnection,
    IConfIncomingMessage,
    IConfMessageSelf,
    IConfIncomingMessageCandidate,
    IConfIncomingMessageOffer,
    IConfIncomingMessageAnswer,
    IConfMessageAddPeer,
    IConfMessageRemovePeer,
    IConfOutgoingMessage
} from '../data';
import {
    createOutgoingMessageJoin,
    createOutgoingMessageCandidate,
    createOutgoingMessageOffer,
    createOutgoingMessageAnswer,
    createOutgoingMessageBye
} from '../services/ConferenceService';

export interface IConferenceProps {
    connect: () => ConferenceConnection;
    room: string;
}

const userMediaConfig = {
    audio: true,
    video: true,
}

export class Conference extends React.Component<IConferenceProps, void> {
    private connection: ConferenceConnection;
    private peerConnections: { [id: string]: RTCPeerConnection };
    private localStream: MediaStream;
    private remoteStreams: { [id: string]: MediaStream };
    private localId: string;
    private candidates: { [id: string]: RTCIceCandidate[] }

    constructor() {
        super();
        this.connection = this.props.connect();
        this.joinRoom(this.props.room);
        this.getUserMedia();

        this.handleIncomingMessage = this.handleIncomingMessage.bind(this);
    }

    // TODO(yunsi): Complete display view.
    public render() {
        return (
            <div />
        )
    }

    public componentWillUnmount() {
        this.leaveRoom()
    }

    private sendMessage(message: IConfOutgoingMessage) {
        this.connection.publish(message);
    }

    private joinRoom(room: string) {
        const message = createOutgoingMessageJoin(room);
        this.sendMessage(message);
    }

    private leaveRoom() {
        const message = createOutgoingMessageBye()
        this.sendMessage(message);
    }

    private getUserMedia() {
        navigator.mediaDevices.getUserMedia(userMediaConfig).then(stream => this.gotStream(stream))
    }

    private gotStream(stream: MediaStream) {
        this.localStream = stream;
        this.connection.subscribe(this.handleIncomingMessage);
    }

    private handleIncomingMessage(message: IConfIncomingMessage) {
        switch (message.type) {
            case 'Self':
                return this.handleSelfMessage(message);
            case 'AddPeer':
                return this.handleAddPeerMessage(message);
            case 'RemovePeer':
                return this.handleRemovePeerMessage(message);
            case 'Candidate':
                return this.handleCandidateMessage(message);
            case 'Offer':
                return this.handleOfferMessage(message);
            case 'Answer':
                return this.handleAnswerMessage(message);
            default:
                return console.log('Unkonw message type')
        }
    }

    private handleSelfMessage(message: IConfMessageSelf) {
        this.localId = message.Id;
    }

    // NOTE(yunsi): When received an AddPeer event, conference will create a new PeerConnection and add it to the connection list.
    private handleAddPeerMessage(message: IConfMessageAddPeer) {
        const id = message.Id;
        const peerConnection = this.createPeerConnectionById(id);

        // NOTE(yunsi): When two clients both recieved an AddPeer event with the other client's id, they will do a compare to see who should create and send the offer.
        if (this.localId.localeCompare(id) === 1) {
            peerConnection.createOffer(
                sessionDescription => this.setLocalAndSendMessage(sessionDescription, 'Offer', id)
            )
            // TODO(yunsi): Add error handling.
        }
    }

    private createPeerConnectionById(id: string) {
        // TODO(yunsi): Add RTCPeerConnection config.
        const peerConnection = new RTCPeerConnection({});
        peerConnection.onicecandidate = (event) => {
            this.handleIceCandidate(event, id)
        };
        peerConnection.onaddstream = (event) => {
            this.handleRemoteStreamAdded(event, id)
        };
        peerConnection.addStream(this.localStream);
        this.peerConnections[id] = peerConnection;

        return peerConnection;
    }

    private handleIceCandidate(event: RTCPeerConnectionIceEvent, id: string) {
        if (event.candidate) {
            const message = createOutgoingMessageCandidate(event.candidate, id);
            this.sendMessage(message);
        }
    }

    private setLocalAndSendMessage(sessionDescription: RTCSessionDescription, type: string, id: string) {
        const peerConnection = this.getPeerConnectionById(id);
        let message;
        if (type === 'Offer') {
            message = createOutgoingMessageOffer(sessionDescription, id);
        } else if (type === 'Answer') {
            message = createOutgoingMessageAnswer(sessionDescription, id);
        }

        if (peerConnection && message) {
            peerConnection.setLocalDescription(sessionDescription);
            // TODO(yunsi): Add error handling.
            this.sendMessage(message);
        }
    }

    private handleRemoteStreamAdded(event: MediaStreamEvent, id: string) {
        // TODO(yunsi): Send MediaStream to Remote stream component.
        if (event.stream) {
            this.remoteStreams[id] = event.stream
        }
    }

    // NOTE(yunsi): When received a RemovePeer event, conference will close that PeerConnection and remove it from the connection list.
    private handleRemovePeerMessage(message: IConfMessageRemovePeer) {
        const id = message.Id;
        const peerConnection = this.getPeerConnectionById(id);

        if (peerConnection) {
            peerConnection.close();
        }

        delete this.peerConnections[id];
        delete this.remoteStreams[id];
    }

    private handleCandidateMessage(message: IConfIncomingMessageCandidate) {
        const id = message.from;
        const peerConnection = this.getPeerConnectionById(id);

        if (peerConnection && peerConnection.remoteDescription) {
            peerConnection.addIceCandidate(message.candidate);
        } else {
            if (this.candidates[id]) {
                this.candidates[id].push(message.candidate);
            } else {
                this.candidates[id] = [message.candidate];
            }
        }
    }

    // NOTE(yunsi): When received an Offer event, conference will set it as RemoteDescription and create an answer to the offer.
    private handleOfferMessage(message: IConfIncomingMessageOffer) {
        const id = message.from;
        const peerConnection = this.getPeerConnectionById(id);

        if (peerConnection) {
            peerConnection.setRemoteDescription(message.sessionDescription, () => {
                this.processCandidates(id);
                peerConnection.createAnswer(
                    sessionDescription => this.setLocalAndSendMessage(sessionDescription, 'Answer', id)
                )
                // TODO(yunsi): Add error handling.
            });
            // TODO(yunsi): Add error handling.
        }
    }

    private handleAnswerMessage(message: IConfIncomingMessageAnswer) {
        const id = message.from;
        const peerConnection = this.getPeerConnectionById(id);

        if (peerConnection) {
            peerConnection.setRemoteDescription(message.sessionDescription, () => {
                this.processCandidates(id);
            });
            // TODO(yunsi): Add error handling.
        }
    }

    private processCandidates(id: string) {
        const peerConnection = this.getPeerConnectionById(id);

        if (peerConnection && this.candidates[id]) {
            while (this.candidates[id].length > 0) {
                const candidate = this.candidates[id].shift();
                if (candidate) {
                    peerConnection.addIceCandidate(candidate);
                }
            }
        }
    }

    private getPeerConnectionById(id: string) {
        if (this.peerConnections[id]) {
            return this.peerConnections[id]
        } else {
            console.log('Can not find PeerConneciotn by id: ' + id);
        }
    }
}