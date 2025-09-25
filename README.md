# Isometric Worlds! 🌍

An AI-powered application that generates infinite isometric worlds by extending seed images using advanced AI models. Upload a seed tile and watch as the AI seamlessly extends your world in all directions!

## Features ✨

- **AI-Powered World Generation**: Uses FAL AI to intelligently extend isometric scenes
- **Multiple Extension Directions**: Extend left, right, and optionally downward
- **Real-time Preview**: See your world grow with each generation step
- **Custom Prompts**: Guide the AI with descriptive prompts for desired world styles
- **High-Quality Output**: Generates detailed, coherent isometric environments

## Prerequisites 📋

Before running this application, make sure you have the following installed:

- **Node.js** (v16 or higher) - [Download here](https://nodejs.org/)
- **npm** (comes with Node.js)
- **Git** - [Download here](https://git-scm.com/)

## Installation 🚀

1. **Clone the repository**
   ```bash
   git clone <your-github-repo-url>
   cd isometric-worlds
   ```

2. **Install dependencies**
   ```bash
   # Install root dependencies
   npm install

   # Install client dependencies
   cd client
   npm install
   cd ..

   # Install server dependencies
   cd server
   npm install
   cd ..
   ```

3. **Set up environment variables**

   Create a `.env` file in the root directory with your FAL AI API key:
   ```
   FAL_KEY=your_fal_api_key_here
   ```

   To get a FAL AI API key:
   1. Visit [FAL AI](https://fal.ai/)
   2. Sign up for an account
   3. Navigate to your API keys section
   4. Generate a new API key
   5. Copy the key to your `.env` file

## Running the Application 🏃‍♂️

### Development Mode (Recommended)

Run both the client and server simultaneously in development mode:

```bash
npm run dev
```

This will:
- Start the React development server on `http://localhost:5173`
- Start the Express server on `http://localhost:4000`
- Enable hot reloading for both frontend and backend

### Production Mode

1. **Build the client**
   ```bash
   npm run build
   ```

2. **Start the production server**
   ```bash
   npm start
   ```

The application will be available at `http://localhost:4000`

### Alternative Scripts

- **Build only**: `npm run build` - Builds the client for production
- **Client development only**: `cd client && npm run dev`
- **Server only**: `cd server && npm start`

## How to Use 🎮

1. **Open your browser** and navigate to `http://localhost:5173` (or `http://localhost:4000` in production)

2. **Upload a seed image**:
   - Click "Attach seed image" and select an isometric tile or scene
   - The image will appear in the preview area

3. **Customize your world** (optional):
   - Add a prompt to guide the AI (e.g., "medieval fantasy village")
   - Check "Extend bottom row" to expand downward as well

4. **Generate your world**:
   - Click "Generate" to start the AI extension process
   - Watch as your world grows step by step!

5. **Continue expanding**:
   - Use the extended image as a new seed
   - Repeat the process to create infinite worlds

## Project Structure 📁

```
isometric-worlds/
├── client/                 # React frontend
│   ├── src/
│   │   ├── App.jsx        # Main application component
│   │   └── App.css        # Styling
│   ├── public/            # Static assets
│   └── package.json       # Client dependencies
├── server/                # Express backend
│   ├── index.js          # Server logic and API endpoints
│   └── package.json      # Server dependencies
├── inputs/               # Sample input images
├── output/               # Generated output images
├── output_jpeg/          # JPEG format outputs
├── trace_full/           # Debug trace images
├── .env                  # Environment variables (create this)
├── .gitignore           # Git ignore rules
└── package.json         # Root package configuration
```

## API Endpoints 🔌

- **POST `/api/extend`**: Extends a seed image using AI
  - Body: `FormData` with `seed` (image file), optional `prompt` and `extendAllDirections`

## Dependencies 📚

### Root
- `sharp`: High-performance image processing
- `concurrently`: Run multiple npm scripts simultaneously

### Client
- `react`: UI framework
- `react-dom`: DOM rendering
- `vite`: Build tool and dev server

### Server
- `express`: Web framework
- `@fal-ai/client`: FAL AI SDK
- `multer`: File upload handling
- `sharp`: Image processing
- `dotenv`: Environment variable management

## Configuration ⚙️

The application uses several configurable parameters in `server/index.js`:

- `MODEL_ID`: AI model for image generation
- `PROMPT`: Default prompt for world extension
- `NUM_INFERENCE_STEPS`: AI generation quality (higher = better but slower)
- `GUIDANCE_SCALE`: How closely AI follows the prompt
- `ITERATIONS`: Number of extension steps
- `RESOLUTION_MODE`: Output resolution mode

## Troubleshooting 🔧

### Common Issues

1. **"FAL_KEY is not configured"**
   - Ensure your `.env` file exists with the correct API key
   - Restart the server after adding the API key

2. **Port already in use**
   - Change the port in `server/index.js` or kill the process using the port

3. **Build errors**
   - Clear node_modules: `rm -rf node_modules && npm install`
   - Clear Vite cache: `cd client && rm -rf node_modules/.vite`

4. **Image upload fails**
   - Ensure images are under 20MB
   - Check file format (supports most common image formats)

### Getting Help

- Check the browser console for client-side errors
- Check the terminal for server-side errors
- Ensure all dependencies are properly installed

## Contributing 🤝

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes and test thoroughly
4. Commit your changes: `git commit -m 'Add feature'`
5. Push to the branch: `git push origin feature-name`
6. Submit a pull request

## License 📄

ISC License - see package.json for details

## Acknowledgments 🙏

- **FAL AI** for providing the powerful image generation API
- **Sharp** for excellent image processing capabilities
- **React** and **Vite** for the modern development experience

---

*Built with ❤️ for creating infinite worlds*
