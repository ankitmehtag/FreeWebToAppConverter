# worker

Renders apps and runs one locked-down Docker container per build. It runs on the host, not in Compose, because it needs the Docker socket.

Build the image, from `android-template/`:

```sh
docker build --platform linux/amd64 --build-arg VERSION_SHA=$(shasum -a 256 version.json | cut -d' ' -f1) -t sitetoapk-builder:dev .
```

Start it with `npm start -w worker`, using the worker settings in `.env.example`.
