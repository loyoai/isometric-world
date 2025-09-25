import { useEffect, useMemo, useState } from 'react';
import './App.css';

const MAX_VIEWPORT_WIDTH = 640;
const ISO_VERTICAL_RATIO = 0.22;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function loadImageInfo(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function useKeyboardNavigation(enabled, step, maxOffset, setOffset) {
  useEffect(() => {
    if (!enabled) {
      return () => {};
    }

    function handleKeyDown(event) {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
      }

      if (event.key === 'ArrowLeft') {
        setOffset((prev) => clamp(prev - step, 0, maxOffset));
      }

      if (event.key === 'ArrowRight') {
        setOffset((prev) => clamp(prev + step, 0, maxOffset));
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, step, maxOffset, setOffset]);
}

function App() {
  const [seedFile, setSeedFile] = useState(null);
  const [seedPreview, setSeedPreview] = useState(null);
  const [serverSeed, setServerSeed] = useState(null);
  const [extended, setExtended] = useState(null);
  const [steps, setSteps] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);

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

  useEffect(() => {
    setOffset(0);
  }, [extended]);

  const viewport = useMemo(() => {
    const src = serverSeed || seedPreview;
    if (!src || !src.width || !src.height) {
      return null;
    }

    const scale = Math.min(1, MAX_VIEWPORT_WIDTH / src.width);
    return {
      width: src.width,
      height: src.height,
      displayWidth: src.width * scale,
      displayHeight: src.height * scale,
      scale,
    };
  }, [serverSeed, seedPreview]);

  const maxOffset = useMemo(() => {
    if (!extended || !viewport) {
      return 0;
    }
    return Math.max(0, extended.width - viewport.width);
  }, [extended, viewport]);

  const step = useMemo(() => {
    if (!viewport) {
      return 0;
    }
    return Math.max(1, Math.round(viewport.width / 12));
  }, [viewport]);

  useKeyboardNavigation(Boolean(extended && viewport), step, maxOffset, setOffset);

  async function handleExtend(event) {
    event.preventDefault();
    setError('');

    if (!seedFile) {
      setError('Choose a seed image first.');
      return;
    }

    const formData = new FormData();
    formData.append('seed', seedFile);

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

  const previewMessage = useMemo(() => {
    if (isLoading) {
      return 'Enhancing via FAL – this can take a moment...';
    }
    if (error) {
      return error;
    }
    if (!extended) {
      return 'Upload a seed image and click Extend to generate extra columns.';
    }
    return 'Use Left and Right arrow keys to slide across the extended scene.';
  }, [isLoading, error, extended]);

  const horizontalShift = viewport ? -offset * viewport.scale : 0;
  const verticalShift = viewport ? offset * ISO_VERTICAL_RATIO * viewport.scale * -1 : 0;

  return (
    <div className="app">
      <header className="app__header">
        <h1>Isometric Extender</h1>
        <p>Upload a square isometric tile, extend it with FAL, then explore using your keyboard.</p>
      </header>

      <form className="uploader" onSubmit={handleExtend}>
        <label className="uploader__field">
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
          <span>{seedFile ? seedFile.name : 'Choose seed.png'}</span>
        </label>
        <button type="submit" disabled={!seedFile || isLoading}>
          {isLoading ? 'Extending…' : 'Extend'}
        </button>
      </form>

      <div className="status">{previewMessage}</div>

      <div className="preview">
        {viewport && (seedPreview?.image || serverSeed?.image) && (
          <div className="preview__column">
            <h2>Seed</h2>
            <div
              className="preview__window"
              style={{ width: viewport.displayWidth, height: viewport.displayHeight }}
            >
              <img
                src={(serverSeed || seedPreview).image}
                alt="Seed"
                style={{ width: '100%', height: '100%' }}
              />
            </div>
            {viewport && (
              <dl className="preview__meta">
                <div>
                  <dt>Size</dt>
                  <dd>
                    {viewport.width} × {viewport.height}
                  </dd>
                </div>
                <div>
                  <dt>Scale</dt>
                  <dd>{viewport.scale.toFixed(2)}×</dd>
                </div>
              </dl>
            )}
          </div>
        )}

        {viewport && extended && (
          <div className="preview__column">
            <h2>Extended Preview</h2>
            <div
              className="preview__window"
              style={{ width: viewport.displayWidth, height: viewport.displayHeight }}
            >
              <img
                src={extended.image}
                alt="Extended"
                className="preview__pan"
                style={{
                  width: extended.width * viewport.scale,
                  height: extended.height * viewport.scale,
                  transform: `translate3d(${horizontalShift}px, ${verticalShift}px, 0)`,
                }}
              />
            </div>
            <dl className="preview__meta">
              <div>
                <dt>Extended width</dt>
                <dd>{extended.width}px</dd>
              </div>
              <div>
                <dt>Offset</dt>
                <dd>
                  {Math.round(offset)} / {Math.round(maxOffset)}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </div>

      {steps.length > 0 && (
        <section className="steps">
          <h2>Trace</h2>
          <p>Each iteration slides the context, calls FAL, extracts the new column, and stitches it onto the seed.</p>
          <div className="steps__grid">
            {steps.map((step) => (
              <article key={step.iteration} className="steps__item">
                <header>Iteration {step.iteration}</header>
                <div className="steps__row">
                  <img src={step.slid} alt={`Iteration ${step.iteration} slid`} />
                  <span>Slid</span>
                </div>
                <div className="steps__row">
                  <img src={step.fal} alt={`Iteration ${step.iteration} fal result`} />
                  <span>FAL</span>
                </div>
                <div className="steps__row">
                  <img src={step.column} alt={`Iteration ${step.iteration} new column`} />
                  <span>Column</span>
                </div>
                <div className="steps__row">
                  <img src={step.extended} alt={`Iteration ${step.iteration} extended`} />
                  <span>Extended</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default App;
