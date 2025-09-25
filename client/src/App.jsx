import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

const DEFAULT_PROMPT =
  'An isometric pixel art scene in top-down RPG style, showing a close-up Paris café. The frame is filled with outdoor tables, umbrellas, cobblestone streets, flower boxes, bicycles, and waiters serving customers. No sky, only terrain and objects. Retro 16-bit pixel game aesthetic, charming and colorful, shadows cast at 45 degrees.';

function loadImageInfo(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return undefined;
    }

    const updateSize = () => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
    };

    updateSize();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateSize());
      observer.observe(element);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  return size;
}

function App() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname.replace(/\/$/, '') : '';
  const isPreviewMode = pathname === '/preview';

  const [seedFile, setSeedFile] = useState(null);
  const [seedPreview, setSeedPreview] = useState(null);
  const [serverSeed, setServerSeed] = useState(null);
  const [extended, setExtended] = useState(null);
  const [steps, setSteps] = useState([]);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [previewAsset, setPreviewAsset] = useState(null);
  const [totalSegments, setTotalSegments] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [seedOrigin, setSeedOrigin] = useState(null);
  const [extendAllDirections, setExtendAllDirections] = useState(false);

  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const pointerRef = useRef({ active: false, origin: { x: 0, y: 0 }, panStart: { x: 0, y: 0 } });
  const lastImageKeyRef = useRef(null);
  const loggedStepCountRef = useRef(0);

  const canvasSize = useElementSize(canvasRef);

  useEffect(() => {
    if (!seedFile) {
      setSeedPreview(null);
      setSteps([]);
      setTotalSegments(0);
      loggedStepCountRef.current = 0;
      setSeedOrigin(null);
      setIsDragging(false);
      setPan({ x: 0, y: 0 });
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

  useEffect(() => {
    if (!isPreviewMode) {
      return;
    }

    let cancelled = false;
    loadImageInfo('/preview.png').then((info) => {
      if (!cancelled && info) {
        setPreviewAsset({ ...info, image: '/preview.png' });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isPreviewMode]);

  const activeImage = useMemo(() => {
    if (extended) {
      return extended;
    }
    if (isPreviewMode && previewAsset) {
      return previewAsset;
    }
    if (serverSeed) {
      return serverSeed;
    }
    if (seedPreview) {
      return seedPreview;
    }
    return null;
  }, [extended, isPreviewMode, previewAsset, seedPreview, serverSeed]);

  const imageMeta = useMemo(() => {
    if (activeImage?.width && activeImage?.height) {
      return { width: activeImage.width, height: activeImage.height };
    }
    return { width: 0, height: 0 };
  }, [activeImage]);

  const seedWidth = useMemo(() => {
    if (extended && serverSeed?.width) {
      return serverSeed.width;
    }
    if (extended && seedPreview?.width) {
      return seedPreview.width;
    }
    if (isPreviewMode && previewAsset) {
      return Math.max(1, previewAsset.width / 3);
    }
    if (serverSeed?.width) {
      return serverSeed.width;
    }
    if (seedPreview?.width) {
      return seedPreview.width;
    }
    return imageMeta.width || 1;
  }, [extended, imageMeta.width, isPreviewMode, previewAsset, seedPreview, serverSeed]);

  const seedHeight = useMemo(() => {
    if (extended && serverSeed?.height) {
      return serverSeed.height;
    }
    if (extended && seedPreview?.height) {
      return seedPreview.height;
    }
    if (isPreviewMode && previewAsset) {
      return Math.max(1, previewAsset.height / 3);
    }
    if (serverSeed?.height) {
      return serverSeed.height;
    }
    if (seedPreview?.height) {
      return seedPreview.height;
    }
    return imageMeta.height || 1;
  }, [extended, imageMeta.height, isPreviewMode, previewAsset, seedPreview, serverSeed]);

  const defaultOffsetX = useMemo(() => {
    if (extended?.seedOffset != null) {
      return extended.seedOffset;
    }
    if (isPreviewMode && previewAsset) {
      return Math.max(0, (imageMeta.width - seedWidth) / 2);
    }
    return 0;
  }, [extended, imageMeta.width, isPreviewMode, previewAsset, seedWidth]);

  const defaultOffsetY = useMemo(() => {
    if (isPreviewMode) {
      return Math.max(0, (imageMeta.height - seedHeight) / 2);
    }
    return 0;
  }, [imageMeta.height, isPreviewMode, seedHeight]);

  const canvasWidth = canvasSize.width || 0;
  const canvasHeight = canvasSize.height || 0;
  const scale = seedWidth > 0 && canvasWidth > 0 ? canvasWidth / seedWidth : 1;

  const viewportWidth = canvasWidth / (scale || 1);
  const viewportHeight = canvasHeight / (scale || 1);

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
    const imageKey = activeImage?.image || '';
    if (!imageKey) {
      lastImageKeyRef.current = null;
      return;
    }

    if (lastImageKeyRef.current === imageKey) {
      return;
    }

    lastImageKeyRef.current = imageKey;
    setPan({
      x: clamp(defaultOffsetX, 0, maxOffsetX),
      y: clamp(defaultOffsetY, 0, maxOffsetY),
    });
  }, [activeImage, defaultOffsetX, defaultOffsetY, maxOffsetX, maxOffsetY]);

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
    if (previewAsset?.image) {
      return previewAsset.image;
    }
    return null;
  }, [extended, previewAsset, seedPreview, serverSeed]);

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
    if (isPreviewMode) {
      return 'Use arrow keys or drag to explore the preview.';
    }
    if (extended) {
      return 'Use arrow keys or drag to explore the extended world.';
    }
    return 'Press Generate whenever you are ready. Arrow keys pan once generated.';
  }, [canvasImage, error, extended, isLoading, isPreviewMode]);


  useEffect(() => {
    if (!steps.length) {
      loggedStepCountRef.current = 0;
      return;
    }

    const total = totalSegments || steps.length;

    for (let index = loggedStepCountRef.current; index < steps.length; index += 1) {
      const step = steps[index];
      const remaining = Math.max(0, total - index - 1);
      const descriptors = [step.direction].concat(step.stage ? [step.stage] : []);
      console.log(`Generated segment ${index + 1}/${total} (${remaining} remaining) [${descriptors.join(' - ')}]`);
    }

    loggedStepCountRef.current = steps.length;
  }, [steps, totalSegments]);
  const stepX = viewportWidth > 0 ? viewportWidth / 6 : 0;
  const stepY = viewportHeight > 0 ? viewportHeight / 6 : 0;

  useEffect(() => {
    if (!canvasImage) {
      return () => {};
    }

    const handleKeyDown = (event) => {
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
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canvasImage, maxOffsetX, maxOffsetY, stepX, stepY]);

  useEffect(() => {
    if (!canvasImage) {
      return () => {};
    }

    const handleMouseMove = (event) => {
      if (!pointerRef.current.active) {
        return;
      }
      event.preventDefault();
      const { origin, panStart } = pointerRef.current;
      const deltaX = (event.clientX - origin.x) / (scale || 1);
      const deltaY = (event.clientY - origin.y) / (scale || 1);
      setPan({
        x: clamp(panStart.x - deltaX, 0, maxOffsetX),
        y: clamp(panStart.y - deltaY, 0, maxOffsetY),
      });
    };

    const handleTouchMove = (event) => {
      if (!pointerRef.current.active || event.touches.length !== 1) {
        return;
      }
      const touch = event.touches[0];
      const { origin, panStart } = pointerRef.current;
      const deltaX = (touch.clientX - origin.x) / (scale || 1);
      const deltaY = (touch.clientY - origin.y) / (scale || 1);
      setPan({
        x: clamp(panStart.x - deltaX, 0, maxOffsetX),
        y: clamp(panStart.y - deltaY, 0, maxOffsetY),
      });
      event.preventDefault();
    };

    const handlePointerUp = () => {
      if (!pointerRef.current.active) {
        return;
      }
      pointerRef.current.active = false;
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchend', handlePointerUp);
    window.addEventListener('touchcancel', handlePointerUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchend', handlePointerUp);
      window.removeEventListener('touchcancel', handlePointerUp);
    };
  }, [canvasImage, maxOffsetX, maxOffsetY, scale]);

  const beginDrag = (clientX, clientY) => {
    if (!canvasImage) {
      return;
    }
    pointerRef.current = {
      active: true,
      origin: { x: clientX, y: clientY },
      panStart: { x: pan.x, y: pan.y },
    };
    setIsDragging(true);
  };

  const handleMouseDown = (event) => {
    if (!canvasImage) {
      return;
    }
    event.preventDefault();
    beginDrag(event.clientX, event.clientY);
  };

  const handleTouchStart = (event) => {
    if (!canvasImage || event.touches.length !== 1) {
      return;
    }
    event.preventDefault();
    const touch = event.touches[0];
    beginDrag(touch.clientX, touch.clientY);
  };

  const dataUrlToFile = async (dataUrl, filename) => {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return new File([blob], filename, { type: blob.type || 'image/png' });
  };

  const handleClearSeed = (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    pointerRef.current.active = false;
    setSeedFile(null);
    setSeedPreview(null);
    setServerSeed(null);
    setExtended(null);
    setSteps([]);
    setTotalSegments(0);
    loggedStepCountRef.current = 0;
    setSeedOrigin(null);
    setError('');
    setIsDragging(false);
    setPan({ x: 0, y: 0 });
    setPrompt(DEFAULT_PROMPT);
    setExtendAllDirections(false);
  };

  async function handleExtend(event) {
    event.preventDefault();
    setError('');

    if (isPreviewMode) {
      return;
    }

    console.log('Generation started — this may take a moment.');
    setSteps([]);
    setTotalSegments(0);
    loggedStepCountRef.current = 0;

    let workingSeedFile = seedFile;

    try {
      setIsLoading(true);

      if (!workingSeedFile) {
        const promptToUse = prompt.trim() || DEFAULT_PROMPT;
        console.log(`Generating base seed from prompt: "${promptToUse}"`);

        const generateResponse = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: promptToUse }),
        });

        if (!generateResponse.ok) {
          const payload = await generateResponse.json().catch(() => ({}));
          throw new Error(payload.error || 'Seed generation failed');
        }

        const seedPayload = await generateResponse.json();
        const generatedFile = await dataUrlToFile(seedPayload.image, 'seed-generated.png');
        setSeedFile(generatedFile);
        setSeedOrigin('generated');
        setSeedPreview({ width: seedPayload.width, height: seedPayload.height, image: seedPayload.image });
        setServerSeed({ width: seedPayload.width, height: seedPayload.height, image: seedPayload.image });
        workingSeedFile = generatedFile;
        setPan({ x: 0, y: 0 });
      }

      if (!workingSeedFile) {
        throw new Error('Attach a seed tile to extend the scene.');
      }

      const formData = new FormData();
      formData.append('seed', workingSeedFile);

      if (prompt.trim()) {
        formData.append('prompt', prompt.trim());
      }

      formData.append('extendAllDirections', extendAllDirections ? 'true' : 'false');

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

      const minimalSteps = Array.isArray(payload.steps)
        ? payload.steps.map(({ iteration, direction, stage }) => ({
            iteration,
            direction,
            stage: stage ?? null,
          }))
        : [];

      setTotalSegments(minimalSteps.length);

      const scheduler = typeof window !== 'undefined' && window.requestAnimationFrame
        ? window.requestAnimationFrame.bind(window)
        : (cb) => setTimeout(cb, 0);

      for (const step of minimalSteps) {
        setSteps((previous) => [...previous, step]);
        // ensure the UI has a moment to update between segments
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => scheduler(resolve));
      }

      console.log(`Generation completed — ${minimalSteps.length} segments captured.`);
    } catch (err) {
      setError(err.message || 'Failed to extend image');
      console.error('Generation failed:', err);
      setSteps([]);
      setTotalSegments(0);
      loggedStepCountRef.current = 0;
    } finally {
      setIsLoading(false);
    }
  }

  const progressPercent = totalSegments > 0 ? Math.min(100, Math.round((steps.length / totalSegments) * 100)) : 0;
  const buttonLabel = isLoading
    ? totalSegments > 0
      ? `Generating… ${progressPercent}%`
      : 'Generating…'
    : 'Generate';

  const isPromptLocked = seedOrigin === 'upload';

  const transformStyle = {
    width: displayWidth || '100%',
    height: displayHeight || '100%',
    transform: `translate3d(${-pan.x * scale || 0}px, ${-pan.y * scale || 0}px, 0)`,
  };

  const contentClassName = `canvas__content${isDragging ? ' is-grabbing' : ''}`;

  return (
    <div className="app">
      <div className="app__background" aria-hidden="true" />
      <header className="app__header">
        <img src="/logo.png" alt="Isometric Worlds" className="app__logo" />
      </header>

      <main className="app__main">
        <section className="canvas" aria-label="Isometric preview">
          <div
            className={canvasImage ? 'canvas__surface has-image' : 'canvas__surface'}
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
          >
            <div className="canvas__grid" aria-hidden="true" />
            {canvasImage ? (
              <div className={contentClassName} style={transformStyle}>
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

      {!isPreviewMode && (
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
              ref={fileInputRef}
              onChange={(event) => {
                const [file] = event.target.files || [];
                if (!file) {
                  return;
                }
                setSeedFile(file);
                setServerSeed(null);
                setExtended(null);
                setSteps([]);
                setTotalSegments(0);
                loggedStepCountRef.current = 0;
                setSeedOrigin('upload');
                setError('');
                setPan({ x: 0, y: 0 });
                event.target.value = '';
              }}
            />
            <span className="command__label">{seedFile ? seedFile.name : 'Attach seed image'}</span>
            {seedFile && (
              <button
                type="button"
                className="command__clear"
                onClick={handleClearSeed}
                aria-label="Remove seed image"
              >
                ×
              </button>
            )}
          </label>
          <input
            type="text"
            name="prompt"
            className="command__input"
            placeholder="Describe how the world should expand…"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={isPromptLocked}
            aria-disabled={isPromptLocked}
            title={isPromptLocked ? 'Prompt editing is disabled while using an uploaded seed. Remove the seed to edit.' : undefined}
          />
          <label className="command__option">
            <input
              type="checkbox"
              checked={extendAllDirections}
              onChange={(event) => setExtendAllDirections(event.target.checked)}
            />
            <span>Extend from all sides</span>
          </label>
          {isPromptLocked && <div className="command__hint">Remove the uploaded seed to edit the prompt.</div>}
          <button type="submit" className="command__submit" disabled={isLoading}>
            {buttonLabel}
          </button>
        </form>
      )}
    </div>
  );
}

export default App;
