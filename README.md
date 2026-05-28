# Study Collab Platform

A production-grade collaborative study platform with real-time whiteboard, chat, WebRTC audio and screen sharing, file uploads, and a premium glassmorphism UI. Built with HTML5, CSS3, vanilla JavaScript, Node.js, Express, Socket.IO, MongoDB, and WebRTC.

## Features
- JWT authentication with bcrypt hashing
- Real-time rooms with Socket.IO
- Ultra-smooth collaborative whiteboard (optimized event sync)
- WebRTC audio calls + screen sharing
- Chat with typing indicators and timestamps
- Friend requests and online status
- File upload and sharing per room
- Room notes with persistence
- Dark, premium glassmorphism UI

## Tech Stack
- Frontend: HTML5, CSS3, Vanilla JS
- Backend: Node.js, Express.js, Socket.IO
- DB: MongoDB with Mongoose
- Realtime: Socket.IO, WebRTC
- File storage: Cloudinary (free tier)

## Project Structure
```
/public
  /css
  /js
  /images
/server
  /routes
  /controllers
  /models
  /middleware
  /socket
  /config
  /utils
```

## Local Setup
1. Install dependencies:
   ```
   npm install
   ```
2. Create a `.env` file based on `.env.example`.
3. Start development server:
   ```
   npm run dev
   ```
4. Open: `http://localhost:4000`

## Environment Variables
- `PORT`: Server port
- `MONGO_URI`: MongoDB connection string
- `JWT_SECRET`: Secret for JWT signing
- `JWT_EXPIRES_IN`: Token lifetime (e.g., `7d`)
- `CLIENT_URL`: Frontend base URL
- `CORS_ORIGINS`: Comma-separated origins
- `MAX_FILE_SIZE_MB`: Upload size cap
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`: Cloudinary credentials
- `CLOUDINARY_FOLDER`: Optional Cloudinary folder name
- `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`: Optional TURN config

## Deployment
- Use Render for the production Node.js service because the app needs Express,
  Socket.IO, WebRTC signaling, and authenticated uploads.
- Use `render.yaml` for the Render blueprint.
- See `DEPLOYMENT.md` for Atlas, Cloudinary, Docker, and Render steps.

### Cloudinary (Free Tier)
- Create a free Cloudinary account and set `CLOUDINARY_CLOUD_NAME`,
  `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in your backend env.

## Notes
- This project uses a mesh WebRTC topology. For large rooms, use an SFU in production.
- Whiteboard sync is event-based to minimize bandwidth.
- Optional TURN credentials can be set using `TURN_URLS`, `TURN_USERNAME`, and
  `TURN_CREDENTIAL` in the backend env.
