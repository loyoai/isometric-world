import { useEffect, useMemo, useState } from 'react';
import './App.css';

function loadImageInfo(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
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
      return 'Use your new extended seed to inspire the next world.';
    }
    return 'Press Generate whenever you are ready.';
  }, [canvasImage, error, extended, isLoading]);

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

  return (
    <div className="app">
      <div className="app__background" aria-hidden="true" />
      <header className="app__header">
        <img src="/logo.png" alt="Isometric Worlds" className="app__logo" />
      </header>

      <main className="app__main">
        <section className="canvas" aria-label="Isometric preview">
          <div className={canvasImage ? 'canvas__surface has-image' : 'canvas__surface'}>
            <div className="canvas__grid" aria-hidden="true" />
            {canvasImage ? (
              <img src={canvasImage} alt="Isometric preview" className="canvas__image" />
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
        <button type="submit" className="command__submit" disabled={isLoading || !seedFile}>
          {isLoading ? 'Generating…' : 'Generate'}
        </button>
      </form>
    </div>
  );
}

export default App;
