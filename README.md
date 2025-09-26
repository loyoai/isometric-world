# Isometric Worlds! 🌍

Generates infinite isometric worlds powered by custom Flux Kontext Dev LORA.

## Features ✨

- **AI-Powered World Generation**: Uses a custom Flux Kontext Dev LORA through FAL AI to intelligently extend isometric scenes
- **Multiple Extension Directions**: Extend on multiple directions
- **Custom Prompts**: Guide the AI with descriptive prompts for desired world styles
- **High-Quality Output**: Generates detailed, coherent isometric environments

## Prerequisites 📋

Before running this application, make sure you have the following installed:

- **Node.js** (v16 or higher)
- **npm** (comes with Node.js)

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
## Running the Application 🏃‍♂️

### Development Mode (Recommended)

Run both the client and server simultaneously in development mode from the root directory:

```bash
npm run dev
```

This will:
- Start the React development server on `http://localhost:5173`
- Start the Express server on `http://localhost:4000`