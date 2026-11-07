# worker

Renders apps and runs one locked-down Docker container per build. It runs on the host, not in Compose, because it needs the Docker socket.

Build the image, from `android-template/`:

```sh
docker build --platform linux/amd64 --build-arg VERSION_SHA=$(shasum -a 256 version.json | cut -d' ' -f1) -t sitetoapk-builder:dev .
```

Start it with `npm start -w worker`, using the worker settings in `.env.example`.

Build one app without the queue, and print its download link:

```sh
npm run build-app -w worker -- /path/to/config.json /path/to/icon.png
```

Before rolling out a new builder image, check it builds and signs the sample app. It exits non-zero on any problem, and never touches the real bucket:

```sh
npm run verify-image -w worker -- sitetoapk-builder:dev
```
