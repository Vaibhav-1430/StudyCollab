import { formatTime, debounce } from './utils.js';

export class ChatManager {
  constructor(socket, roomCode, elements) {
    this.socket = socket;
    this.roomCode = roomCode;
    this.list = elements.list;
    this.form = elements.form;
    this.input = elements.input;
    this.typing = elements.typing;
    this.typingTimeout = null;
  }

  init() {
    this.form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = this.input.value.trim();
      if (!value) return;
      this.socket.emit('chat:message', { code: this.roomCode, content: value });
      this.input.value = '';
    });

    this.input?.addEventListener(
      'input',
      debounce(() => {
        this.socket.emit('chat:typing', { code: this.roomCode, isTyping: true });
        clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
          this.socket.emit('chat:typing', { code: this.roomCode, isTyping: false });
        }, 1200);
      }, 300)
    );

    this.socket.on('chat:history', ({ messages }) => {
      if (this.list) {
        this.list.innerHTML = '';
      }
      messages.forEach((msg) => this.addMessage(msg));
    });

    this.socket.on('chat:message', (message) => {
      this.addMessage(message);
    });

    this.socket.on('chat:typing', ({ name, isTyping }) => {
      if (!this.typing) return;
      this.typing.textContent = isTyping ? `${name} is typing...` : '';
    });
  }

  addMessage(message) {
    if (!this.list) return;
    const item = document.createElement('div');
    item.className = 'chat-message';
    item.innerHTML = `
      <div class="meta">${message.sender?.name || 'Anon'} - ${formatTime(
      message.createdAt
    )}</div>
      <div>${message.content}</div>
    `;
    this.list.appendChild(item);
    this.list.scrollTop = this.list.scrollHeight;
  }
}
