import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { Sofa, Armchair, Table2, BedDouble, BookOpen, Trash2, Sparkles, Image as ImageIcon, Mic } from "lucide-react";
import { generateLayout, detectFurniture, transcribeAudio } from "./api.js";
import { footprint, isInsideRoom, layoutStats, optimizeLayout, overlaps } from "./layoutOptimizer.js";

const CATALOG = [
  { id: "sofa", name: "Sofa", icon: Sofa, color: 0x5b6b8c, size: [1.8, 0.7, 0.8] },
  { id: "chair", name: "Chair", icon: Armchair, color: 0xb3563e, size: [0.6, 0.8, 0.6] },
  { id: "table", name: "Table", icon: Table2, color: 0x8a6a4a, size: [1.2, 0.45, 0.7] },
  { id: "bed", name: "Bed", icon: BedDouble, color: 0x9a8f7e, size: [1.6, 0.4, 2.0] },
  { id: "shelf", name: "Shelf", icon: BookOpen, color: 0x4a4238, size: [1.0, 1.6, 0.35] },
];

const ROOM_SIZE = 8;

export default function App() {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const meshMapRef = useRef({});
  const floorRef = useRef(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const draggingRef = useRef(null);

  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const nextId = useRef(1);

  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState(null); // { kind: "loading"|"error"|"info", text }
  const [stats, setStats] = useState({ collisions: 0, inBounds: 0, score: 0, quality: 100 });

  // ---- one-time three.js setup ----
  useEffect(() => {
    const mount = mountRef.current;
    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3efe6);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(7, 7, 7);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(5, 10, 5);
    scene.add(dirLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_SIZE, ROOM_SIZE),
      new THREE.MeshStandardMaterial({ color: 0xe8e0cf })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    floorRef.current = floor;

    scene.add(new THREE.GridHelper(ROOM_SIZE, 16, 0xcfc5ae, 0xdcd3bd));

    const wallMat = new THREE.MeshStandardMaterial({ color: 0xfaf7ef });
    const wallBack = new THREE.Mesh(new THREE.BoxGeometry(ROOM_SIZE, 2, 0.1), wallMat);
    wallBack.position.set(0, 1, -ROOM_SIZE / 2);
    scene.add(wallBack);
    const wallLeft = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2, ROOM_SIZE), wallMat);
    wallLeft.position.set(-ROOM_SIZE / 2, 1, 0);
    scene.add(wallLeft);

    let frameId;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

  return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  // ---- sync meshes to items state ----
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const map = meshMapRef.current;

    Object.keys(map).forEach((id) => {
      if (!items.find((it) => String(it.id) === id)) {
        scene.remove(map[id]);
        map[id].geometry.dispose();
        map[id].material.dispose();
        delete map[id];
      }
    });

    items.forEach((item) => {
      const def = CATALOG.find((c) => c.id === item.typeId);
      if (!def) return;
      let mesh = map[item.id];
      if (!mesh) {
        const geo = new THREE.BoxGeometry(...def.size);
        const mat = new THREE.MeshStandardMaterial({ color: def.color });
        mesh = new THREE.Mesh(geo, mat);
        scene.add(mesh);
        map[item.id] = mesh;
      }
      mesh.position.set(item.x, def.size[1] / 2, item.z);
      mesh.rotation.y = item.rotation ?? 0;
      mesh.material.emissive = new THREE.Color(item.id === selectedId ? 0x333333 : 0x000000);
    });
  }, [items, selectedId]);

  useEffect(() => {
    setStats(layoutStats(items, CATALOG));
  }, [items]);

  const getPointerNDC = (e) => {
    const rect = rendererRef.current.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
  };

  const onPointerDown = useCallback((e) => {
    const ndc = getPointerNDC(e);
    raycasterRef.current.setFromCamera(ndc, cameraRef.current);
    const meshes = Object.entries(meshMapRef.current);
    const hits = raycasterRef.current.intersectObjects(meshes.map(([, m]) => m));
    if (hits.length > 0) {
      const found = meshes.find(([, m]) => m === hits[0].object);
      if (found) {
        const id = Number(found[0]);
        setSelectedId(id);
        draggingRef.current = id;
      }
    } else {
      setSelectedId(null);
    }
  }, []);

  const onPointerMove = useCallback((e) => {
    if (draggingRef.current == null) return;
    const ndc = getPointerNDC(e);
    raycasterRef.current.setFromCamera(ndc, cameraRef.current);
    const hit = raycasterRef.current.intersectObject(floorRef.current)[0];
    if (!hit) return;
    const dragged = items.find((it) => it.id === draggingRef.current);
    if (!dragged) return;
    const candidate = { ...dragged, x: hit.point.x, z: hit.point.z };
    const [w, d] = footprint(CATALOG, candidate);
    const half = ROOM_SIZE / 2;
    candidate.x = Math.max(-half + w / 2, Math.min(half - w / 2, candidate.x));
    candidate.z = Math.max(-half + d / 2, Math.min(half - d / 2, candidate.z));

    const collision = items.some((it) => it.id !== candidate.id && overlaps(candidate, it, CATALOG));
    if (collision) return;
    setItems((prev) => prev.map((it) => (it.id === draggingRef.current ? candidate : it)));
  }, [items]);

  const onPointerUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  const addItem = (typeId, x = (Math.random() - 0.5) * 3, z = (Math.random() - 0.5) * 3, rotation = 0) => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, typeId, x, z, rotation }]);
    return id;
  };

  const removeSelected = () => {
    if (selectedId == null) return;
    setItems((prev) => prev.filter((it) => it.id !== selectedId));
    setSelectedId(null);
  };

  // ---- AI-backed actions ----
  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setStatus({ kind: "loading", text: "Asking Gemini for a layout..." });
    try {
      const generated = await generateLayout(prompt);
      const generatedWithIds = generated.map((it) => ({ ...it, id: nextId.current++ }));
      const optimized = optimizeLayout(generatedWithIds, CATALOG);
      setItems((prev) => [...prev, ...optimized]);
      setStatus({ kind: "info", text: `AI proposed ${generated.length} item(s), then the layout optimizer resolved spatial constraints.` });
    } catch (err) {
      setStatus({ kind: "error", text: err.message });
    }
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setStatus({ kind: "loading", text: "Detecting furniture in your photo..." });
    try {
      const detected = await detectFurniture(file);
      const detectedWithIds = detected.map((it) => ({ ...it, id: nextId.current++ }));
      const optimized = optimizeLayout(detectedWithIds, CATALOG);
      setItems((prev) => [...prev, ...optimized]);
      setStatus({ kind: "info", text: `Detected ${detected.length} item(s) and optimized their placement.` });
    } catch (err) {
      setStatus({ kind: "error", text: err.message });
    }
    e.target.value = "";
  };

  const handleAudioUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setStatus({ kind: "loading", text: "Transcribing audio..." });
    try {
      const text = await transcribeAudio(file);
      setPrompt(text);
      setStatus({ kind: "info", text: "Transcribed. Click Generate to build the layout." });
    } catch (err) {
      setStatus({ kind: "error", text: err.message });
    }
    e.target.value = "";
  };

  const handleOptimize = () => {
    if (items.length < 2) {
      setStatus({ kind: "info", text: "Add at least two pieces to optimize the room." });
      return;
    }
    setStatus({ kind: "loading", text: "Optimizing spatial layout..." });
    const before = layoutStats(items, CATALOG);
    const optimized = optimizeLayout(items, CATALOG);
    const after = layoutStats(optimized, CATALOG);
    setItems(optimized);
    setStatus({ kind: "info", text: `Optimization complete: ${before.collisions} → ${after.collisions} collisions, quality ${before.quality}% → ${after.quality}%.` });
  };

  const rotateSelected = () => {
    if (selectedId == null) return;
    setItems((prev) => prev.map((it) => {
      if (it.id !== selectedId) return it;
      const next = { ...it, rotation: (it.rotation ?? 0) + Math.PI / 2 };
      return isInsideRoom(CATALOG, next) ? next : it;
    }));
  };

  return (
    <div style={styles.root}>
      <div style={styles.sidebar}>
        <div style={styles.title}>Room designer</div>
        <div style={styles.sub}>Click a piece to add it, then drag it on the floor.</div>

        {CATALOG.map((c) => (
          <div key={c.id} style={styles.catItem} onClick={() => addItem(c.id)}>
            <span style={{ ...styles.swatch, background: `#${c.color.toString(16).padStart(6, "0")}` }} />
            {c.name}
          </div>
        ))}

        <div style={styles.sectionTitle}>AI + algorithms</div>
        <div style={styles.stats}>Layout quality: <strong>{stats.quality}%</strong><br />Collisions: <strong>{stats.collisions}</strong> · In bounds: <strong>{stats.inBounds}/{items.length}</strong></div>
        <button style={styles.actionBtn} onClick={handleOptimize}>
          <Sparkles size={13} /> Optimize layout
        </button>

        <div style={styles.sectionTitle}>Generate with AI (Gemini)</div>
        <textarea
          style={styles.textarea}
          placeholder="e.g. a cozy reading corner with a bookshelf"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button style={styles.actionBtn} onClick={handleGenerate}>
          <Sparkles size={13} /> Generate
        </button>

        <div style={styles.sectionTitle}>Detect from a photo (Cloud Vision)</div>
        <label style={styles.fileBtn}>
          <ImageIcon size={13} /> Upload photo
          <input type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhotoUpload} />
        </label>

        <div style={styles.sectionTitle}>Describe out loud (ElevenLabs)</div>
        <label style={styles.fileBtn}>
          <Mic size={13} /> Upload audio
          <input type="file" accept="audio/*" style={{ display: "none" }} onChange={handleAudioUpload} />
        </label>

        {status && (
          <div style={{ ...styles.status, color: status.kind === "error" ? "#B3563E" : "#6B6355" }}>
            {status.text}
          </div>
        )}

        <div style={styles.listTitle}>In the room ({items.length})</div>
        <div style={styles.list}>
          {items.map((it) => {
            const def = CATALOG.find((c) => c.id === it.typeId);
            return (
              <div
                key={it.id}
                style={{ ...styles.listItem, background: it.id === selectedId ? "#EFE3D8" : "transparent" }}
                onClick={() => setSelectedId(it.id)}
              >
                {def?.name ?? it.typeId}
              </div>
            );
          })}
        </div>

        <button style={styles.removeBtn} onClick={rotateSelected} disabled={selectedId == null}>
          ↻ Rotate selected
        </button>
        <button style={styles.removeBtn} onClick={removeSelected} disabled={selectedId == null}>
          <Trash2 size={13} /> Remove selected
        </button>
      </div>

      <div style={styles.canvasWrap}>
        <div
          ref={mountRef}
          style={{ width: "100%", height: "100%", cursor: "grab" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />
      </div>
    </div>
  );
}

const styles = {
  root: { display: "flex", height: "100vh", background: "#F3EFE6", fontFamily: "Segoe UI, sans-serif" },
  sidebar: { width: 260, flexShrink: 0, background: "#FAF7EF", borderRight: "1px solid #E7DEC8", padding: 20, display: "flex", flexDirection: "column", overflowY: "auto" },
  title: { fontWeight: 700, fontSize: 16, marginBottom: 4, color: "#241F1A" },
  sub: { fontSize: 12, color: "#6B6355", marginBottom: 16, lineHeight: 1.4 },
  catItem: { display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#241F1A", marginBottom: 4 },
  swatch: { width: 14, height: 14, borderRadius: 4, flexShrink: 0 },
  sectionTitle: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "#6B6355", marginTop: 16, marginBottom: 6 },
  textarea: { width: "100%", minHeight: 50, fontSize: 12, padding: 8, borderRadius: 8, border: "1px solid #E2D8C2", resize: "vertical", fontFamily: "inherit" },
  actionBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", background: "#B3563E", color: "white", border: "none", padding: 8, borderRadius: 8, fontSize: 12, cursor: "pointer", marginTop: 8 },
  fileBtn: { display: "flex", alignItems: "center", gap: 6, width: "100%", background: "#F0E9D8", color: "#241F1A", border: "1px solid #E2D8C2", padding: 8, borderRadius: 8, fontSize: 12, cursor: "pointer", boxSizing: "border-box" },
  status: { fontSize: 11, marginTop: 10, lineHeight: 1.4 },
  stats: { fontSize: 11, color: "#6B6355", lineHeight: 1.6, padding: "8px 10px", background: "#F0E9D8", borderRadius: 8 },
  listTitle: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "#6B6355", marginTop: 18, marginBottom: 6 },
  list: { flex: 1, overflowY: "auto", minHeight: 40 },
  listItem: { fontSize: 12, padding: "6px 8px", borderRadius: 6, marginBottom: 2, cursor: "pointer" },
  removeBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#B3563E", color: "white", border: "none", padding: 8, borderRadius: 8, fontSize: 12, cursor: "pointer", marginTop: 10 },
  canvasWrap: { flex: 1, position: "relative" },
};
