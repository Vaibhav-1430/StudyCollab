# StudyCollab Production Deployment

## Required Environment Variables

Set these in Render or your container runtime:

- `NODE_ENV=production`
- `CORS_ORIGINS=https://your-render-service.onrender.com`
- `CLIENT_URL=https://your-render-service.onrender.com` optional when it matches `CORS_ORIGINS`
- `MONGO_URI=mongodb+srv://...`
- `JWT_SECRET` with at least 32 random characters
- `JWT_EXPIRES_IN=7d`
- `CLOUDINARY_FOLDER=study-collab`
- `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` for reliable WebRTC outside easy NATs

Optional tuning:

- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` enable uploads and avatars
- `MONGO_MAX_POOL_SIZE=20`
- `RATE_LIMIT_MAX=120`
- `MAX_FILE_SIZE_MB=20`
- `LOG_LEVEL=info`

## MongoDB Atlas

1. Create an Atlas cluster in the same region as Render when possible.
2. Create a database user with read/write access to the StudyCollab database.
3. Add Render outbound IPs to Atlas Network Access, or use `0.0.0.0/0` only if you also use a strong database user password.
4. Copy the SRV connection string into `MONGO_URI`.
5. Use `retryWrites=true&w=majority` in the URI.
6. Keep `MONGO_AUTO_INDEX=false` in production after indexes exist.

## Render

1. Push this repo to GitHub.
2. Create a Render Blueprint from `render.yaml`, or create a Node web service manually.
3. Set `CORS_ORIGINS` to the Render service URL. Set `CLIENT_URL` too if you use a separate frontend URL.
4. Set `MONGO_URI`, Cloudinary values, and TURN credentials.
5. Deploy. Render should run `npm ci` and `npm start`.
6. Confirm `/healthz` returns `200` and `/readyz` returns `{"ready":true}`.

## Docker

Local container run with bundled MongoDB:

```bash
JWT_SECRET="$(openssl rand -hex 32)" \
CLOUDINARY_CLOUD_NAME="your-cloud" \
CLOUDINARY_API_KEY="your-key" \
CLOUDINARY_API_SECRET="your-secret" \
docker compose up --build
```

Production image only:

```bash
docker build -t studycollab .
docker run --env-file .env.production -p 4000:4000 studycollab
```

Do not bake real secrets into the image. Pass them as runtime environment variables.

## Security Checklist

- Use HTTPS only in production.
- Set exact `CORS_ORIGINS`; do not use wildcards.
- Use a 32+ character random `JWT_SECRET`.
- Use MongoDB Atlas database users with least privilege.
- Enable Cloudinary signed account credentials only on the backend.
- Configure TURN credentials for reliable screen sharing and audio across NATs.
- Keep `MAX_FILE_SIZE_MB` conservative.
- Monitor `/healthz`, app logs, and Render restart events.

## Scaling Notes

- Single-instance Socket.IO works as-is.
- For multiple instances, add a Socket.IO Redis adapter and sticky sessions.
- Move ephemeral room state to Redis before horizontal scaling.
- Keep MongoDB and Render in nearby regions.
- Raise `MONGO_MAX_POOL_SIZE` gradually as concurrent room count grows.
- Use paid Render instances for production WebSocket reliability.
