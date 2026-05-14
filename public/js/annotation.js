import { throttle } from './utils.js';

const createId = () =>
  (window.crypto?.randomUUID && window.crypto.randomUUID()) ||
  `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export class AnnotationLayer {
  constructor(canvas, stage, socket, roomCode, target) {
    this.canvas = canvas;
    this.stage = stage;
    this.socket = socket;
    this.roomCode = roomCode;
    this.target = target || 'screen';
    this.ctx = canvas.getContext('2d');

    this.tool = 'pencil';
    this.color = '#6ee7ff';
    this.size = 4;
    this.dpr = window.devicePixelRatio || 1;

    this.events = [];
    this.redo = [];
    this.currentStroke = null;
    this.previewShape = null;
    this.textEditor = null;
    this.isDrawing = false;
    this.enabled = true;

    this.emitStrokePoint = throttle((point) => {
      if (!this.currentStroke) return;
      this.socket.emit('annot:stroke:point', {
        code: this.roomCode,
        target: this.target,
        strokeId: this.currentStroke.id,
        point
      });
    }, 16);

    this.needsRender = true;

    this.resizeCanvas();
    this.bindEvents();
    this.attachSocket();
    this.renderLoop();
  }

  bindEvents() {
    window.addEventListener('resize', () => this.resizeCanvas());

    this.canvas.addEventListener('pointerdown', (event) =>
      this.onPointerDown(event)
    );
    this.canvas.addEventListener('pointermove', (event) =>
      this.onPointerMove(event)
    );
    this.canvas.addEventListener('pointerup', () => this.onPointerUp());
    this.canvas.addEventListener('pointerleave', () => this.onPointerUp());
  }

  attachSocket() {
    this.socket.on('annot:stroke:start', ({ target, stroke }) => {
      if (target !== this.target) return;
      this.events.push({
        type: 'stroke',
        id: stroke.id,
        color: stroke.color,
        size: stroke.size,
        mode: stroke.mode,
        points: [stroke.point]
      });
      this.needsRender = true;
    });

    this.socket.on('annot:stroke:point', ({ target, strokeId, point }) => {
      if (target !== this.target) return;
      const stroke = this.events.find(
        (event) => event.type === 'stroke' && event.id === strokeId
      );
      if (stroke) {
        stroke.points.push(point);
        this.needsRender = true;
      }
    });

    this.socket.on('annot:shape:add', ({ target, shape }) => {
      if (target !== this.target) return;
      this.events.push({ type: 'shape', ...shape });
      this.needsRender = true;
    });

    this.socket.on('annot:text:add', ({ target, text }) => {
      if (target !== this.target) return;
      this.events.push({ type: 'text', ...text });
      this.needsRender = true;
    });

    this.socket.on('annot:clear', ({ target }) => {
      if (target !== this.target) return;
      this.events.push({ type: 'clear', id: Date.now() });
      this.redo = [];
      this.needsRender = true;
    });

    this.socket.on('annot:sync-data', ({ target, events }) => {
      if (target !== this.target) return;
      this.loadEvents(events);
    });
  }

  setTarget(target) {
    this.target = target;
    this.requestSync();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.canvas.style.pointerEvents = enabled ? 'auto' : 'none';
  }

  setTool(tool) {
    this.tool = tool;
  }

  setColor(color) {
    this.color = color;
  }

  setSize(size) {
    this.size = size;
  }

  undo() {
    this.socket.emit('annot:undo', { code: this.roomCode, target: this.target });
  }

  redoAction() {
    this.socket.emit('annot:redo', { code: this.roomCode, target: this.target });
  }

  clear() {
    this.socket.emit('annot:clear', { code: this.roomCode, target: this.target });
  }

  requestSync() {
    this.socket.emit('annot:sync-request', {
      code: this.roomCode,
      target: this.target
    });
  }

  loadEvents(events = []) {
    this.events = Array.isArray(events) ? events : [];
    this.redo = [];
    this.needsRender = true;
  }

  resizeCanvas() {
    const { width, height } = this.stage.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * this.dpr;
    this.canvas.height = height * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.needsRender = true;
  }

  openTextEditor(point) {
    if (this.textEditor) {
      this.textEditor.remove();
      this.textEditor = null;
    }

    const editor = document.createElement('div');
    editor.className = 'text-editor';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Add note';

    const actions = document.createElement('div');
    actions.className = 'text-editor-actions';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-primary';
    addBtn.textContent = 'Add';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-ghost';
    cancelBtn.textContent = 'Cancel';

    actions.appendChild(addBtn);
    actions.appendChild(cancelBtn);
    editor.appendChild(input);
    editor.appendChild(actions);

    editor.style.left = `${point.x}px`;
    editor.style.top = `${point.y}px`;
    this.stage.appendChild(editor);
    input.focus();

    const commit = () => {
      const text = input.value.trim();
      if (!text) {
        editor.remove();
        this.textEditor = null;
        return;
      }

      const payload = {
        id: createId(),
        text,
        position: point,
        color: this.color,
        size: Math.max(this.size * 3, 14)
      };
      this.events.push({ type: 'text', ...payload });
      this.socket.emit('annot:text:add', {
        code: this.roomCode,
        target: this.target,
        text: payload
      });

      this.needsRender = true;
      editor.remove();
      this.textEditor = null;
    };

    addBtn.addEventListener('click', commit);
    cancelBtn.addEventListener('click', () => {
      editor.remove();
      this.textEditor = null;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') commit();
      if (event.key === 'Escape') {
        editor.remove();
        this.textEditor = null;
      }
    });

    this.textEditor = editor;
  }

  onPointerDown(event) {
    if (!this.enabled) return;
    this.canvas.setPointerCapture(event.pointerId);
    const point = { x: event.offsetX, y: event.offsetY };

    if (['pencil', 'highlighter', 'eraser'].includes(this.tool)) {
      this.startStroke(point);
      return;
    }

    if (['rect', 'ellipse'].includes(this.tool)) {
      this.previewShape = {
        type: this.tool,
        start: point,
        end: point,
        color: this.color,
        size: this.size
      };
      this.needsRender = true;
      return;
    }

    if (this.tool === 'text') {
      this.openTextEditor(point);
    }
  }

  onPointerMove(event) {
    if (!this.enabled) return;
    const point = { x: event.offsetX, y: event.offsetY };

    if (this.currentStroke) {
      this.addStrokePoint(point);
      return;
    }

    if (this.previewShape) {
      this.previewShape.end = point;
      this.needsRender = true;
    }
  }

  onPointerUp() {
    if (this.currentStroke) {
      this.finishStroke();
    }

    if (this.previewShape) {
      const shape = {
        id: createId(),
        shapeType: this.previewShape.type,
        start: this.previewShape.start,
        end: this.previewShape.end,
        color: this.previewShape.color,
        size: this.previewShape.size
      };
      this.events.push({ type: 'shape', ...shape });
      this.socket.emit('annot:shape:add', {
        code: this.roomCode,
        target: this.target,
        shape
      });
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
      size: this.size,
      mode,
      points: [point]
    };

    this.currentStroke = stroke;
    this.events.push({ type: 'stroke', ...stroke });

    this.socket.emit('annot:stroke:start', {
      code: this.roomCode,
      target: this.target,
      stroke: {
        id: stroke.id,
        color: stroke.color,
        size: stroke.size,
        mode: stroke.mode,
        point
      }
    });

    this.needsRender = true;
  }

  addStrokePoint(point) {
    this.currentStroke.points.push(point);
    this.emitStrokePoint(point);
    this.needsRender = true;
  }

  finishStroke() {
    this.socket.emit('annot:stroke:end', {
      code: this.roomCode,
      target: this.target,
      strokeId: this.currentStroke.id
    });
    this.currentStroke = null;
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
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();

    const lastClear = this.events
      .map((event, index) => (event.type === 'clear' ? index : -1))
      .reduce((acc, value) => Math.max(acc, value), -1);
    const drawEvents = lastClear >= 0 ? this.events.slice(lastClear + 1) : this.events;

    drawEvents.forEach((event) => {
      if (event.type === 'stroke') this.drawStroke(event);
      if (event.type === 'shape') this.drawShape(event);
      if (event.type === 'text') this.drawText(event);
    });

    if (this.previewShape) {
      this.drawShape({
        shapeType: this.previewShape.type,
        start: this.previewShape.start,
        end: this.previewShape.end,
        color: this.previewShape.color,
        size: this.previewShape.size
      });
    }
  }

  drawStroke(stroke) {
    const ctx = this.ctx;
    if (stroke.points.length < 2) return;
    ctx.save();
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = stroke.size;
    ctx.strokeStyle = stroke.color;

    if (stroke.mode === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
    } else if (stroke.mode === 'highlight') {
      ctx.globalAlpha = 0.35;
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }

    stroke.points.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });

    ctx.stroke();
    ctx.restore();
  }

  drawShape(shape) {
    const ctx = this.ctx;
    const x = Math.min(shape.start.x, shape.end.x);
    const y = Math.min(shape.start.y, shape.end.y);
    const width = Math.abs(shape.end.x - shape.start.x);
    const height = Math.abs(shape.end.y - shape.start.y);

    ctx.save();
    ctx.lineWidth = shape.size;
    ctx.strokeStyle = shape.color;

    if (shape.shapeType === 'rect') {
      ctx.strokeRect(x, y, width, height);
    } else if (shape.shapeType === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawText(text) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = text.color;
    ctx.font = `${text.size}px 'Space Grotesk'`;
    ctx.fillText(text.text, text.position.x, text.position.y);
    ctx.restore();
  }
}
