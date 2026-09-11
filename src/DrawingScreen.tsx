import { useEffect, useRef, useState } from "react";
import {
  Stage,
  Layer,
  Line,
  Rect,
  Image as KonvaImage,
  Transformer,
} from "react-konva";
import Konva from "konva";
import { Icon, IconButton } from "./icons";
import Pen, { penNames } from "./Pen";
import {
  useStore,
  type Note,
  type Drawing,
  type DrawingPage,
  type DrawingImage,
  type Stroke,
} from "./store";
const colors = [
  "#ff4c55",
  "#ff8045",
  "#ffad40",
  "#ffcd39",
  "#fff045",
  "#b9e632",
  "#72cd37",
  "#32c8c5",
  "#3da6f7",
  "#5c7cf4",
  "#9454d9",
  "#ed51ad",
  "#000000",
];
const shades = [
  "#0a2900",
  "#1a5100",
  "#359f08",
  "#72cd37",
  "#b8eb8b",
  "#dcf5bf",
  "#f5fced",
];
function CanvasImage({
  item,
  selected,
  onSelect,
  onChange,
}: {
  item: DrawingImage;
  selected: boolean;
  onSelect: () => void;
  onChange: (item: DrawingImage) => void;
}) {
  const [image, setImage] = useState<HTMLImageElement>();
  const ref = useRef<Konva.Image>(null);
  const transformer = useRef<Konva.Transformer>(null);
  useEffect(() => {
    const img = new window.Image();
    img.onload = () => setImage(img);
    img.src = item.src;
  }, [item.src]);
  useEffect(() => {
    if (selected && ref.current && transformer.current) {
      transformer.current.nodes([ref.current]);
      transformer.current.getLayer()?.batchDraw();
    }
  }, [selected, image]);
  return (
    <>
      <KonvaImage
        ref={ref}
        image={image}
        {...item}
        draggable={selected}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={(e) =>
          onChange({ ...item, x: e.target.x(), y: e.target.y() })
        }
        onTransformEnd={() => {
          const n = ref.current!;
          onChange({
            ...item,
            x: n.x(),
            y: n.y(),
            width: Math.max(15, n.width() * n.scaleX()),
            height: Math.max(15, n.height() * n.scaleY()),
            rotation: n.rotation(),
          });
          n.scaleX(1);
          n.scaleY(1);
        }}
      />
      {selected && (
        <Transformer
          ref={transformer}
          flipEnabled={false}
          keepRatio={true}
          rotateEnabled={false}
          boundBoxFunc={(old, b) => (b.width < 15 || b.height < 15 ? old : b)}
        />
      )}
    </>
  );
}
export default function DrawingScreen({
  note,
  drawingId,
  onDone,
}: {
  note: Note;
  drawingId?: string;
  onDone: (drawingId: string) => void;
}) {
  const updateNote = useStore((s) => s.updateNote);
  const resolvedDrawingId = drawingId || crypto.randomUUID();
  const existing = note.drawings?.find((item) => item.id === resolvedDrawingId);
  const [record, setRecord] = useState<DrawingPage>(() => existing || {
    id: resolvedDrawingId,
    drawing: resolvedDrawingId === "legacy" ? (note.drawing || { strokes: [], images: [] }) : { strokes: [], images: [] },
    preview: resolvedDrawingId === "legacy" ? note.drawingPreview : undefined,
    width: 900,
    height: 1200,
  });
  const [history, setHistory] = useState<Drawing[]>([record.drawing]);
  const [index, setIndex] = useState(0);
  const drawing = history[index];
  const [active, setActive] = useState<Stroke | null>(null);
  const [tool, setTool] = useState("Pencil");
  const [color, setColor] = useState("#359f08");
  const [colorFamily, setColorFamily] = useState(6);
  const activeShades =
    colorFamily === 6
      ? shades
      : [0.2, 0.4, 0.7, 1, 1.35, 1.65, 1.9].map((factor) => {
          const base = colors[colorFamily];
          const channels = [1, 3, 5].map((offset) =>
            parseInt(base.slice(offset, offset + 2), 16),
          );
          return (
            "#" +
            channels
              .map((channel) =>
                Math.round(
                  factor <= 1
                    ? channel * factor
                    : channel + (255 - channel) * (factor - 1),
                )
                  .toString(16)
                  .padStart(2, "0"),
              )
              .join("")
          );
        });
  const [palette, setPalette] = useState(false);
  const [size, setSize] = useState(4);
  const [selected, setSelected] = useState("");
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [error, setError] = useState("");
  const [eraserMode, setEraserMode] = useState<"stroke" | "pixel">("stroke");
  const [bounds, setBounds] = useState({ width: 430, height: 850 });
  const container = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage>(null);
  const input = useRef<HTMLInputElement>(null);
  const activeRef = useRef<Stroke | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setBounds({ width, height });
    });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const commit = (next: Drawing) => {
    setHistory((h) => [...h.slice(0, index + 1), next]);
    setIndex(index + 1);
  };
  const updateRecord = (patch: Partial<DrawingPage>) => setRecord((item) => ({ ...item, ...patch }));
  const undo = () => {
    setIndex((i) => Math.max(0, i - 1));
    setSelected("");
  };
  const redo = () => setIndex((i) => Math.min(history.length - 1, i + 1));
  const point = () => {
    const p = stage.current?.getPointerPosition();
    return p
      ? { x: (p.x - position.x) / zoom, y: (p.y - position.y) / zoom }
      : null;
  };
  const finish = () => {
    if (activeRef.current) {
      commit({ ...drawing, strokes: [...drawing.strokes, activeRef.current] });
      activeRef.current = null;
      setActive(null);
    }
  };
  const save = () => {
    try {
      setSelected("");
      const st = stage.current!;
      const oldPosition = st.position();
      const oldScale = st.scale();
      st.position({ x: 0, y: 0 });
      st.scale({ x: 1, y: 1 });
      const tr = st.find("Transformer");
      tr.forEach((n) => n.hide());
      const points = drawing.strokes.flatMap((stroke) => stroke.points);
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < points.length; i += 2) {
        minX = Math.min(minX, points[i]);
        minY = Math.min(minY, points[i + 1]);
        maxX = Math.max(maxX, points[i]);
        maxY = Math.max(maxY, points[i + 1]);
      }
      for (const image of drawing.images) {
        minX = Math.min(minX, image.x);
        minY = Math.min(minY, image.y);
        maxX = Math.max(maxX, image.x + image.width);
        maxY = Math.max(maxY, image.y + image.height);
      }
      if (!Number.isFinite(minX)) {
        minX = 0;
        minY = 0;
        maxX = 120;
        maxY = 120;
      }
      const padding = 20;
      const cropX = Math.max(0, minX - padding);
      const cropY = Math.max(0, minY - padding);
      const cropRight = Math.min(record.width, maxX + padding);
      const cropBottom = Math.min(record.height, maxY + padding);
      const preview = st.toDataURL({
        x: cropX,
        y: cropY,
        width: Math.max(1, cropRight - cropX),
        height: Math.max(1, cropBottom - cropY),
        pixelRatio: 1,
      });
      tr.forEach((n) => n.show());
      st.position(oldPosition);
      st.scale(oldScale);
      const saved = { ...record, id: resolvedDrawingId, drawing, preview };
      const drawings = note.drawings || [];
      const nextDrawings = resolvedDrawingId === "legacy"
        ? drawings
        : drawings.some((item) => item.id === resolvedDrawingId)
          ? drawings.map((item) => item.id === resolvedDrawingId ? saved : item)
          : [...drawings, saved];
      updateNote(note.id, {
        drawings: nextDrawings,
        drawing,
        drawingPreview: preview,
        date: new Date().toISOString(),
      });
      onDone(resolvedDrawingId);
    } catch {
      setError("Could not save this drawing. Try a smaller image.");
    }
  };
  const importImage = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    if (file.size > 3 * 1024 * 1024) {
      setError("Choose an image smaller than 3 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const id = crypto.randomUUID();
        commit({
          ...drawing,
          images: [
            ...drawing.images,
            {
              id,
              src: String(reader.result),
              x: 45,
              y: 110,
              width: 160,
              height: (160 * img.height) / img.width,
              rotation: 0,
            },
          ],
        });
        setTool("Move");
        setSelected(id);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };
  return (
    <div className="drawing-screen" ref={container}>
      <Stage
        ref={stage}
        width={bounds.width}
        height={bounds.height}
        scaleX={zoom}
        scaleY={zoom}
        x={position.x}
        y={position.y}
        draggable={tool === "Move" && !selected}
        onDragEnd={(e) => {
          if (e.target === stage.current)
            setPosition({ x: e.target.x(), y: e.target.y() });
        }}
        onWheel={(e) => {
          e.evt.preventDefault();
          const p = stage.current?.getPointerPosition();
          if (!p) return;
          const next = Math.max(
            0.3,
            Math.min(3, zoom * (e.evt.deltaY > 0 ? 0.9 : 1.1)),
          );
          setPosition({
            x: p.x - ((p.x - position.x) / zoom) * next,
            y: p.y - ((p.y - position.y) / zoom) * next,
          });
          setZoom(next);
        }}
        onPointerDown={(e) => {
          if (tool === "Move") {
            if (e.target === stage.current) setSelected("");
            return;
          }
          if (e.evt.button > 0) return;
          const p = point();
          if (!p) return;
          (e.evt.target as Element)?.setPointerCapture(e.evt.pointerId);
          setPalette(false);
          setSelected("");
          const stroke: Stroke = {
            id: crypto.randomUUID(),
            points: [p.x, p.y, p.x + 0.01, p.y + 0.01],
            color,
            width:
              size *
              (tool === "Marker"
                ? 5
                : tool === "Brush"
                  ? 2
                  : tool === "Eraser"
                    ? 5
                    : 1) *
              (e.evt.pointerType === "pen"
                ? Math.max(0.2, e.evt.pressure * 2)
                : 1),
            opacity: tool === "Marker" ? 0.45 : tool === "Brush" ? 0.75 : 1,
            tool,
          };
          activeRef.current = stroke;
          setActive(stroke);
        }}
        onPointerMove={() => {
          const p = point();
          if (activeRef.current && p) {
            const next = {
              ...activeRef.current,
              points: [...activeRef.current.points, p.x, p.y],
            };
            activeRef.current = next;
            setActive(next);
          }
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <Layer listening={false}>
          <Rect
            x={0}
            y={0}
            width={record.width}
            height={record.height}
            fill="#fff"
            shadowColor="#000"
            shadowBlur={18}
            shadowOpacity={0.16}
            shadowOffset={{ x: 0, y: 4 }}
          />
        </Layer>
        <Layer>
          {drawing.images.map((item) => (
            <CanvasImage
              key={item.id}
              item={item}
              selected={item.id === selected}
              onSelect={() => {
                if (tool === "Move") setSelected(item.id);
              }}
              onChange={(item) =>
                commit({
                  ...drawing,
                  images: drawing.images.map((i) =>
                    i.id === item.id ? item : i,
                  ),
                })
              }
            />
          ))}
        </Layer>
        <Layer>
          {[...drawing.strokes, ...(active ? [active] : [])].map((s) => (
            <Line
              key={s.id}
              points={s.points}
              stroke={s.color}
              strokeWidth={s.width}
              opacity={s.opacity}
              tension={0.35}
              lineCap={s.tool === "Marker" ? "butt" : "round"}
              lineJoin={s.tool === "Marker" ? "miter" : "round"}
              globalCompositeOperation={
                s.tool === "Eraser" ? "destination-out" : "source-over"
              }
              listening={tool === "Eraser" && eraserMode === "stroke"}
              onPointerDown={(e) => {
                if (tool === "Eraser" && eraserMode === "stroke") {
                  e.cancelBubble = true;
                  activeRef.current = null;
                  setActive(null);
                  commit({
                    ...drawing,
                    strokes: drawing.strokes.filter((x) => x.id !== s.id),
                  });
                }
              }}
            />
          ))}
        </Layer>
      </Stage>
      <header className="drawing-topbar">
        <div>
          <IconButton
            icon="undo"
            label="Undo drawing"
            disabled={index === 0}
            onClick={undo}
          />
          <IconButton
            icon="redo"
            label="Redo drawing"
            disabled={index === history.length - 1}
            onClick={redo}
          />
        </div>
        <div>
          <IconButton
            icon="focus"
            label="Reset canvas view"
            onClick={() => {
              setZoom(1);
              setPosition({ x: 0, y: 0 });
            }}
          />
          <IconButton icon="check" label="Save drawing" onClick={save} />
        </div>
      </header>
      <div className="page-size-controls" aria-label="Drawing page size">
        <label>W <input aria-label="Page width" type="number" min="240" max="4000" value={record.width} onChange={(e) => updateRecord({ width: Math.max(240, Math.min(4000, Number(e.target.value) || 240)) })} /></label>
        <label>H <input aria-label="Page height" type="number" min="240" max="4000" value={record.height} onChange={(e) => updateRecord({ height: Math.max(240, Math.min(4000, Number(e.target.value) || 240)) })} /></label>
      </div>
      <div className="canvas-options">
        <IconButton
          icon="image"
          label="Import drawing image"
          onClick={() => input.current?.click()}
        />
        <IconButton
          icon="move"
          label="Move canvas or image"
          aria-pressed={tool === "Move"}
          onClick={() => {
            setTool("Move");
            setPalette(false);
          }}
        />
        {selected && (
          <IconButton
            icon="trash"
            label="Delete selected image"
            onClick={() => {
              commit({
                ...drawing,
                images: drawing.images.filter((i) => i.id !== selected),
              });
              setSelected("");
            }}
          />
        )}
      </div>
      {error && (
        <p className="drawing-error" role="alert">
          {error}
        </p>
      )}
      {palette ? (
        <div className="color-picker">
          <div className="shades">
            {activeShades.map((c) => (
              <button
                key={c}
                aria-label={`Shade ${c}`}
                className={color === c ? "chosen" : ""}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
          <div className="spectrum">
            {colors.map((c, family) => (
              <button
                aria-label={`Color ${c}`}
                key={c}
                className={colorFamily === family ? "chosen" : ""}
                style={{ background: c }}
                onClick={() => {
                  setColor(c);
                  setColorFamily(family);
                }}
              />
            ))}
          </div>
          <button className="palette-done" onClick={() => setPalette(false)}>
            Done
          </button>
        </div>
      ) : (
        <>
          <div className="pen-settings">
            {tool === "Eraser" ? (
              <>
                <button
                  className={eraserMode === "stroke" ? "chosen" : ""}
                  aria-label="Stroke eraser"
                  onClick={() => setEraserMode("stroke")}
                >
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M2 12h6v6H2zm6-6h6v6H8zm6 6h6v6h-6zm6-6h4v6h-4z" />
                  </svg>
                </button>
                <button
                  className={eraserMode === "pixel" ? "chosen" : ""}
                  aria-label="Pixel eraser"
                  onClick={() => setEraserMode("pixel")}
                >
                  <Icon name="draw" />
                </button>
              </>
            ) : (
              <label title="Stroke width">
                <input
                  aria-label="Stroke width"
                  type="range"
                  min="1"
                  max="18"
                  value={size}
                  onChange={(e) => setSize(Number(e.target.value))}
                />
              </label>
            )}
          </div>
          <div className="pen-dock">
            <button
              className="color-swatch"
              aria-label="Open colors"
              style={{ background: tool === "Eraser" ? "#000" : color }}
              onClick={() => setPalette(true)}
            />
            {penNames.map((name) => (
              <button
                key={name}
                className={`pen ${tool === name ? "selected" : ""}`}
                aria-label={name}
                aria-pressed={tool === name}
                onClick={() => {
                  setTool(name);
                  setSelected("");
                }}
              >
                <Pen
                  kind={name}
                  color={
                    name === "Brush"
                      ? "#39adf2"
                      : name === "Pencil"
                        ? "#222"
                        : color
                  }
                />
              </button>
            ))}
            <button
              className="paper-tool"
              aria-label="Import image"
              onClick={() => input.current?.click()}
            >
              <span />
              <span />
            </button>
          </div>
        </>
      )}
      <input
        hidden
        ref={input}
        type="file"
        accept="image/*"
        onChange={(e) => {
          if (e.target.files?.[0]) importImage(e.target.files[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
