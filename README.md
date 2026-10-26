# Swim Territory

Claim real-world map territory by completing swims. Working name; the shark-themed name is still to be decided.

## Running the app on your phone (Windows)

One-time setup on your PC:

1. Install **Node.js LTS** from https://nodejs.org (accept the defaults).
2. Install **Git** from https://git-scm.com/download/win (accept the defaults).
3. Open **Command Prompt** and download the code:
   ```
   git clone https://github.com/<your-username>/swim-territory.git
   cd swim-territory
   npm install
   ```

Each time you want to try the latest version:

1. In Command Prompt, inside the `swim-territory` folder:
   ```
   git pull
   npx expo start
   ```
2. A QR code appears. Open **Expo Go** on your Android phone and scan it.
3. Your phone and PC need to be on the same Wi-Fi. If it won't connect, stop it with Ctrl+C and run `npx expo start --tunnel` instead.

## Build plan

1. Blank app on the phone ✅
2. Map where you trace a shape, snapped to roads, showing its distance
3. Save the shape as a pending challenge (Supabase)
4. Colour the territory once a qualifying swim is done
5. Strava connection for real watch-recorded swims
