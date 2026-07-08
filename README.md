# VLEM Desktop

Lightweight macOS/Windows desktop client for VLEM.

## Current Scope

This repo contains the first Desktop client slice:

- first-launch backend URL setup
- generated local client id
- launch-time `/alert` fetch
- `/sub/{id}` subscription fetch and authorization QR flow
- mode/routing controls
- node list parsing and display
- Tauri command boundary for native proxy, stop, and delay checks

The native Xray runner, system proxy management, and TUN implementation are intentionally still behind Tauri commands.

## Development

```sh
npm install
npm run dev
```

To build the web layer:

```sh
npm run build
```

To run as a Tauri app, install the Rust toolchain first, then run:

```sh
npm run tauri:dev
```

## Configuration

The app asks for the VLEM backend base URL on first launch and stores it locally. The URL should point to the deployed Worker origin, for example:

```text
https://vlem.example.com
```
