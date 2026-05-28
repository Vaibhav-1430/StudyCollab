const BOARD_WIDTH = 2400;
const BOARD_HEIGHT = 1350;

const createId = () =>
  (window.crypto?.randomUUID && window.crypto.randomUUID()) ||
  `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const lastClearIndex = (events) =>
  events.reduce((latest, event, index) => (event.type === 'clear' ? index : latest), -1);

export class Whiteboard {
  constructor(canvas, stage, socket, roomCode) {
    this.canvas = canvas;
    this.stage = stage;
    this.socket = socket;
    this.roomCode = roomCode;
    this.ctx = canvas.getContext('2d', { alpha: true });

    this.tool = 'pencil';
    this.color = '#6ee7ff';
    this.size = 5;
    this.scale = 1;
    this.offset = { x: 0, y: 0 };
    this.dpr = window.devicePixelRatio || 1;
    this.rect = { width: 1, height: 1 };

    this.events = [];
    this.currentStroke = null;
    this.pendingPoints = [];
    this.previewShape = null;
    this.textEditor = null;
    this.needsRender = true;
    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());

    this.flushPoints = this.flushPoints.bind(this);
    this.flushTimer = window.setInterval(this.flushPoints, 28);

    this.resizeCanvas();
    this.resizeObserver.observe(this.stage);
    this.bindEvents();
    this.attachSocket();
    this.renderLoop();
  }

  bindEvents() {
    this.canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.canvas.addEventListener('pointermove', (event) => this.onPointerMove(event));
    this.canvas.addEventListener('pointerup', (event) => this.onPointerUp(event));
    this.canvas.addEventListener('pointercancel', (event) => this.onPointerUp(event));
    this.canvas.addEventListener('pointerleave', (event) => this.onPointerUp(event));
  }

  attachSocket() {
    this.socket.on('board:stroke:start', ({ stroke }) => {
      this.events.push({ type: 'stroke', ...stroke, points: [stroke.point] });
      this.needsRender = true;
    });

    this.socket.on('board:stroke:point', ({ strokeId, point }) => {
      this.addRemotePoints(strokeId, [point]);
    });

    this.socket.on('board:stroke:points', ({ strokeId, points }) => {
      this.addRemotePoints(strokeId, points);
    });

    this.socket.on('board:shape:add', ({ shape }) => {
      this.events.push({ type: 'shape', ...shape });
      this.needsRender = true;
    });

    this.socket.on('board:text:add', ({ text }) => {
      this.events.push({ type: 'text', ...text });
      this.needsRender = true;
    });

    this.socket.on('board:clear', () => {
      this.events.push({ type: 'clear', id: createId() });
      this.needsRender = true;
    });

    this.socket.on('board:sync-data', ({ events }) => this.loadEvents(events));
  }

  setTool(tool) {
    this.tool = tool === 'sticky' ? 'text' : tool;
    this.canvas.dataset.tool = this.tool;
  }

  setColor(color) {
    this.color = color;
  }

  setSize(size) {
    this.size = clamp(Number(size) || 5, 1, 36);
  }

  setZoom(scale) {
    this.scale = clamp(scale, 0.55, 2.4);
    this.centerBoard();
    this.needsRender = true;
  }

  undo() {
    this.socket.emit('board:undo', { code: this.roomCode });
  }

  redoAction() {
    this.socket.emit('board:redo', { code: this.roomCode });
  }

  clear() {
    this.socket.emit('board:clear', { code: this.roomCode });
  }

  getEvents() {
    return this.events;
  }

  loadEvents(events = []) {
    this.events = Array.isArray(events) ? events : [];
    this.needsRender = true;
  }

  refreshSize() {
    this.resizeCanvas();
  }

  resizeCanvas() {
    const rect = this.stage.getBoundingClientRect();
    this.rect = {
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height)
    };
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.rect.width * this.dpr);
    this.canvas.height = Math.round(this.rect.height * this.dpr);
    this.centerBoard();
    this.needsRender = true;
  }

  centerBoard() {
    const fit = Math.min(this.rect.width / BOARD_WIDTH, this.rect.height / BOARD_HEIGHT);
    this.viewScale = fit * this.scale;
    this.offset.x = (this.rect.width - BOARD_WIDTH * this.viewScale) / 2;
    this.offset.y = (this.rect.height - BOARD_HEIGHT * this.viewScale) / 2;
  }

  pointerToWorld(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left - this.offset.x) / this.viewScale, 0, BOARD_WIDTH),
      y: clamp((event.clientY - rect.top - this.offset.y) / this.viewScale, 0, BOARD_HEIGHT),
      pressure: event.pressure || 0.5
    };
  }

  worldToScreen(point) {
    return {
      x: point.x * this.viewScale + this.offset.x,
      y: point.y * this.viewScale + this.offset.y
    };
  }

  addRemotePoints(strokeId, points = []) {
    const stroke = this.events.find((event) => event.type === 'stroke' && event.id === strokeId);
    if (!stroke || !Array.isArray(points) || !points.length) return;
    stroke.points.push(...points);
    this.needsRender = true;
  }

  onPointerDown(event) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    try {
      this.canvas.setPointerCapture?.(event.pointerId);
    } catch (err) {
      // Synthetic validation events and some touch stacks may not support capture.
    }
    const point = this.pointerToWorld(event);

    if (['pencil', 'highlighter', 'eraser'].includes(this.tool)) {
      this.startStroke(point);
      return;
    }

    if (['rect', 'ellipse'].includes(this.tool)) {
      this.previewShape = {
        shapeType: this.tool,
        start: point,
        end: point,
        color: this.color,
        size: this.size
      };
      this.needsRender = true;
      return;
    }

    if (this.tool === 'text') this.openTextEditor(point);
  }

  onPointerMove(event) {
    if (!this.currentStroke && !this.previewShape) return;
    event.preventDefault();
    const point = this.pointerToWorld(event);

    if (this.currentStroke) {
      const last = this.currentStroke.points[this.currentStroke.points.length - 1];
      const dx = point.x - last.x;
      const dy = point.y - last.y;
      if (Math.hypot(dx, dy) < 1.8) return;
      this.currentStroke.points.push(point);
      this.pendingPoints.push(point);
      this.needsRender = true;
    }

    if (this.previewShape) {
      this.previewShape.end = point;
      this.needsRender = true;
    }
  }

  onPointerUp(event) {
    if (event?.pointerId) {
      try {
        this.canvas.releasePointerCapture?.(event.pointerId);
      } catch (err) {
        // Capture may already be released.
      }
    }
    if (this.currentStroke) this.finishStroke();

    if (this.previewShape) {
      const shape = { id: createId(), ...this.previewShape };
      this.events.push({ type: 'shape', ...shape });
      this.socket.emit('board:shape:add', { code: this.roomCode, shape });
      this.previewShape = null;
      this.needsRender = true;
    }
  }

  startStroke(point) {
    const mode =
      this.tool === 'eraser' ? 'erase' : this.tool === 'highlighter' ? 'highlight' : 'draw';
    const stroke = {
      id: createId(),
      color: this.color,
      size: this.tool === 'eraser' ? this.size * 3 : this.size,
      mode,
      points: [point]
    };
    this.currentStroke = stroke;
    this.pendingPoints = [];
    this.events.push({ type: 'stroke', ...stroke });
    this.socket.emit('board:stroke:start', {
      code: this.roomCode,
      stroke: { id: stroke.id, color: stroke.color, size: stroke.size, mode, point }
    });
    this.needsRender = true;
  }

  flushPoints() {
    if (!this.currentStroke || !this.pendingPoints.length) return;
    const points = this.pendingPoints.splice(0, this.pendingPoints.length);
    this.socket.emit('board:stroke:points', {
      code: this.roomCode,
      strokeId: this.currentStroke.id,
      points
    });
  }

  finishStroke() {
    this.flushPoints();
    this.socket.emit('board:stroke:end', {
      code: this.roomCode,
      strokeId: this.currentStroke.id
    });
    this.currentStroke = null;
  }

  openTextEditor(point) {
    this.textEditor?.remove();
    const editor = document.createElement('form');
    editor.className = 'text-editor';
    editor.innerHTML = `
      <input type="text" maxlength="180" placeholder="Add text" autocomplete="off" />
      <div class="text-editor-actions">
        <button class="btn btn-ghost" type="button" data-cancel>Cancel</button>
        <button class="btn btn-primary" type="submit">Add</button>
      </div>
    `;
    const screen = this.worldToScreen(point);
    editor.style.left = `${screen.x}px`;
    editor.style.top = `${screen.y}px`;
    this.stage.appendChild(editor);
    this.textEditor = editor;

    const input = editor.querySelector('input');
    input.focus();

    const close = () => {
      editor.remove();
      this.textEditor = null;
    };

    editor.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) return close();
      const text = {
        id: createId(),
        text: value,
        position: point,
        color: this.color,
        size: Math.max(this.size * 4, 18)
      };
      this.events.push({ type: 'text', ...text });
      this.socket.emit('board:text:add', { code: this.roomCode, text });
      this.needsRender = true;
      close();
    });

    editor.querySelector('[data-cancel]').addEventListener('click', close);
  }

  renderLoop() {
    if (this.needsRender) {
      this.render();
      this.needsRender = false;
    }
    requestAnimationFrame(() => this.renderLoop());
  }

  render() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    ctx.save();
    ctx.translate(this.offset.x, this.offset.y);
    ctx.scale(this.viewScale, this.viewScale);
    this.drawBoardBackground(ctx);

    const clearIndex = lastClearIndex(this.events);
    const drawable = clearIndex >= 0 ? this.events.slice(clearIndex + 1) : this.events;
    drawable.forEach((event) => this.drawEvent(ctx, event));
    if (this.previewShape) this.drawShape(ctx, this.previewShape);
    ctx.restore();
  }

  drawBoardBackground(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(8, 13, 25, 0.74)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    ctx.strokeRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    ctx.restore();
  }

  drawEvent(ctx, event) {
    if (event.type === 'stroke') this.drawStroke(ctx, event);
    if (event.type === 'shape') this.drawShape(ctx, event);
    if (event.type === 'text') this.drawText(ctx, event);
  }

  drawStroke(ctx, stroke) {
    if (!stroke.points?.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = stroke.size;
    ctx.strokeStyle = stroke.color;
    ctx.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.globalAlpha = stroke.mode === 'highlight' ? 0.32 : 1;
    ctx.beginPath();
    const points = stroke.points;
    ctx.moveTo(points[0].x, points[0].y);
    if (points.length === 1) {
      ctx.lineTo(points[0].x + 0.1, points[0].y + 0.1);
    } else {
      for (let i = 1; i < points.length - 1; i += 1) {
        const midX = (points[i].x + points[i + 1].x) / 2;
        const midY = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
      }
      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawShape(ctx, shape) {
    const x = Math.min(shape.start.x, shape.end.x);
    const y = Math.min(shape.start.y, shape.end.y);
    const width = Math.abs(shape.end.x - shape.start.x);
    const height = Math.abs(shape.end.y - shape.start.y);
    ctx.save();
    ctx.lineWidth = shape.size;
    ctx.strokeStyle = shape.color;
    if (shape.shapeType === 'rect') ctx.strokeRect(x, y, width, height);
    if (shape.shapeType === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawText(ctx, text) {
    ctx.save();
    ctx.fillStyle = text.color;
    ctx.font = `600 ${text.size}px "Plus Jakarta Sans", sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(text.text, text.position.x, text.position.y);
    ctx.restore();
  }
}
