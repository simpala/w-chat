import {
    HandleChat
} from '../../wailsjs/go/main/App';

export function sendMessage(sessionId, message) {
    return HandleChat(sessionId, message);
}
