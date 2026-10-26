# Swim Territory

Claim real-world map territory by completing swims. Working name; the shark-themed name is still to be decided.

## Running the app on your phone (Windows)

One-time setup on your PC:

1. Install **Node.js LTS** from https://nodejs.org (accept the defaults).
2. Install **Git** from https://git-scm.com/download/win (accept the defaults).
3. Open **Command Prompt** and download the code:
   ```
   git clone https://github.com/mardonben/swim-territory.git
   cd swim-territory
   npm install
   ```
4. Add your Mapbox key so the map can load. Log in at https://account.mapbox.com, copy the **Default public token** (it starts with `pk.`), then in Command Prompt inside the `swim-territory` folder run this, pasting your token in place of `pk.YOUR_TOKEN`:
   ```
   echo EXPO_PUBLIC_MAPBOX_TOKEN=pk.YOUR_TOKEN> .env.local
   ```
   This file stays on your PC only and is never uploaded to GitHub. Public tokens are designed to live inside apps, but don't paste it into chats.

Each time you want to try the latest version:

1. In Command Prompt, inside the `swim-territory` folder:
   ```
   git pull
   npm install
   npx expo start
   ```
2. A QR code appears. Open **Expo Go** on your Android phone and scan it.
3. Your phone and PC need to be on the same Wi-Fi. If it won't connect, stop it with Ctrl+C and run `npx expo start --tunnel` instead.

## Drawing a shape

1. Allow location when asked, and the map jumps to where you are.
2. Pinch and drag to find your area, then tap **✏️ Draw**.
3. Trace a loop with one finger and lift it. The app finds the roads, paths and field edges inside your loop and wraps a blocky outline around them, joining road ends with straight edges where there's no road.
4. The number shown is the swim that claims it. Every 1 km you swim claims 4 km of outline, so a 4 km outline is a 1 km swim.
5. Tap **✋ Move map** to pan again, or **🗑️ Clear** to start over.

## Build plan

1. Blank app on the phone ✅
2. Map where you trace a shape, outlined from the roads inside it, showing the swim to claim it ✅
3. Save the shape as a pending challenge (Supabase)
4. Colour the territory once a qualifying swim is done
5. Strava connection for real watch-recorded swims
