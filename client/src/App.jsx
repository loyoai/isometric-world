import { useEffect, useMemo, useState, useRef, useLayoutEffect } from 'react';
import './App.css';

function loadImageInfo(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function App() {
  const [seedFile, setSeedFile] = useState(null);
  const [seedPreview, setSeedPreview] = useState(null);
  const [serverSeed, setServerSeed] = useState(null);
  const [extended, setExtended] = useState(null);
  const [, setSteps] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [extendBottomRow, setExtendBottomRow] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const canvasRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = canvasRef.current;
    if (!element) {
      return undefined;
    }

    const updateSize = () => {
      setCanvasSize({ width: element.clientWidth, height: element.clientHeight });
    };

    updateSize();

    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(() => updateSize());
      resizeObserver.observe(element);
      return () => resizeObserver.disconnect();
    }

    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  useEffect(() => {
    if (!seedFile) {
      setSeedPreview(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      const info = await loadImageInfo(dataUrl);
      setSeedPreview(info ? { ...info, image: dataUrl } : { image: dataUrl });
    };
    reader.readAsDataURL(seedFile);
  }, [seedFile]);

  const seedMeta = useMemo(() => {
    if (serverSeed?.width && serverSeed?.height) {
      return { width: serverSeed.width, height: serverSeed.height };
    }
    if (seedPreview?.width && seedPreview?.height) {
      return { width: seedPreview.width, height: seedPreview.height };
    }
    return null;
  }, [seedPreview, serverSeed]);


  const imageMeta = useMemo(() => {
    if (extended?.width && extended?.height) {
      return { width: extended.width, height: extended.height };
    }
    if (serverSeed?.width && serverSeed?.height) {
      return { width: serverSeed.width, height: serverSeed.height };
    }
    if (seedPreview?.width && seedPreview?.height) {
      return { width: seedPreview.width, height: seedPreview.height };
    }
    return { width: 0, height: 0 };
  }, [extended, seedPreview, serverSeed]);

  const canvasWidth = canvasSize.width || 0;
  const canvasHeight = canvasSize.height || 0;
  const seedWidth = seedMeta?.width || imageMeta.width || 1;
  const scaleRaw = seedWidth > 0 && canvasWidth > 0 ? canvasWidth / seedWidth : 1;
  const scale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 1;

  const viewportWidth = canvasWidth / scale || seedWidth;
  const viewportHeight = canvasHeight / scale || seedMeta?.height || imageMeta.height;

  const maxOffsetX = imageMeta.width > 0 ? Math.max(0, imageMeta.width - viewportWidth) : 0;
  const maxOffsetY = imageMeta.height > 0 ? Math.max(0, imageMeta.height - viewportHeight) : 0;

  const displayWidth = imageMeta.width * scale;
  const displayHeight = imageMeta.height * scale;

  useEffect(() => {
    setPan((previous) => ({
      x: clamp(previous.x, 0, maxOffsetX),
      y: clamp(previous.y, 0, maxOffsetY),
    }));
  }, [maxOffsetX, maxOffsetY]);

  useEffect(() => {
    if (!extended) {
      setPan({ x: 0, y: 0 });
      return;
    }

    setPan((previous) => ({
      x: clamp(extended.seedOffset ?? previous.x ?? 0, 0, maxOffsetX),
      y: clamp(previous.y, 0, maxOffsetY),
    }));
  }, [extended, maxOffsetX, maxOffsetY]);

  const canvasImage = useMemo(() => {
    if (extended?.image) {
      return extended.image;
    }
    if (serverSeed?.image) {
      return serverSeed.image;
    }
    if (seedPreview?.image) {
      return seedPreview.image;
    }
    return null;
  }, [extended, serverSeed, seedPreview]);

  const statusMessage = useMemo(() => {
    if (isLoading) {
      return 'Summoning new terrain via FAL…';
    }
    if (error) {
      return error;
    }
    if (!canvasImage) {
      return null;
    }
    if (extended) {
      return 'Use arrow keys to explore the extended world.';
    }
    return 'Press Generate whenever you are ready. Arrow keys pan once generated.';
  }, [canvasImage, error, extended, isLoading]);

  const stepX = viewportWidth > 0 ? viewportWidth / 6 : 0;
  const stepY = viewportHeight > 0 ? viewportHeight / 6 : 0;

  useEffect(() => {
    if (!canvasImage) {
      return () => {};
    }

    function handleKeyDown(event) {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        return;
      }

      event.preventDefault();

      setPan((current) => {
        let nextX = current.x;
        let nextY = current.y;

        if (event.key === 'ArrowLeft') {
          nextX = clamp(current.x - stepX, 0, maxOffsetX);
        }
        if (event.key === 'ArrowRight') {
          nextX = clamp(current.x + stepX, 0, maxOffsetX);
        }
        if (event.key === 'ArrowUp') {
          nextY = clamp(current.y - stepY, 0, maxOffsetY);
        }
        if (event.key === 'ArrowDown') {
          nextY = clamp(current.y + stepY, 0, maxOffsetY);
        }

        if (nextX === current.x && nextY === current.y) {
          return current;
        }
        return { x: nextX, y: nextY };
      });
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canvasImage, maxOffsetX, maxOffsetY, stepX, stepY]);

  async function handleExtend(event) {
    event.preventDefault();
    setError('');

    if (!seedFile) {
      setError('Attach a seed tile to extend the scene.');
      return;
    }

    const formData = new FormData();
    formData.append('seed', seedFile);

    if (prompt.trim()) {
      formData.append('prompt', prompt.trim());
    }

    formData.append('extendAllDirections', extendBottomRow ? 'true' : 'false');

    try {
      setIsLoading(true);
      const response = await fetch('/api/extend', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Request failed');
      }

      const payload = await response.json();
      setServerSeed(payload.seed);
      setExtended(payload.extended);
      setSteps(payload.steps);
    } catch (err) {
      setError(err.message || 'Failed to extend image');
    } finally {
      setIsLoading(false);
    }
  }

  const transformStyle = {
    width: displayWidth || '100%',
    height: displayHeight || '100%',
    transform: `translate3d(${-pan.x * scale || 0}px, ${-pan.y * scale || 0}px, 0)`,
  };

  return (
    <div className="app">
      <div className="app__background" aria-hidden="true" />
      <header className="app__header">
        <img src="/logo.png" alt="Isometric Worlds" className="app__logo" />
      </header>

      <main className="app__main">
        <section className="canvas" aria-label="Isometric preview">
          <div className={canvasImage ? 'canvas__surface has-image' : 'canvas__surface'} ref={canvasRef}>
            <div className="canvas__grid" aria-hidden="true" />
            {canvasImage ? (
              <div className="canvas__content" style={transformStyle}>
                <img src={canvasImage} alt="Isometric preview" className="canvas__image" />
              </div>
            ) : (
              <div className="canvas__empty">
                <h2>Build you infiniate world!</h2>
              </div>
            )}
            {statusMessage && <div className="canvas__status">{statusMessage}</div>}
          </div>
        </section>
      </main>

      <form className="command" onSubmit={handleExtend}>
        <label className="command__upload">
          <span className="command__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img" focusable="false">
              <path
                d="M12 4a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5a1 1 0 0 1 1-1z"
                fill="currentColor"
              />
            </svg>
          </span>
          <input
            type="file"
            accept="image/*"
            onChange={(event) => {
              const [file] = event.target.files || [];
              setSeedFile(file || null);
              setServerSeed(null);
              setExtended(null);
              setSteps([]);
              setError('');
            }}
          />
          <span className="command__label">{seedFile ? seedFile.name : 'Attach seed image'}</span>
        </label>
        <input
          type="text"
          name="prompt"
          className="command__input"
          placeholder="Describe how the world should expand…"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <label className="command__toggle">
          <input
            type="checkbox"
            checked={extendBottomRow}
            onChange={(event) => setExtendBottomRow(event.target.checked)}
          />
          <span>Extend bottom row</span>
        </label>
        <button type="submit" className="command__submit" disabled={isLoading || !seedFile}>
          {isLoading ? 'Generating…' : 'Generate'}
        </button>
      </form>
    </div>
  );
}

export default App;
