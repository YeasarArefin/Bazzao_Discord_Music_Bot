# Bazzao Discord Music Bot

A powerful and easy-to-use Discord music bot that brings high-quality music streaming to your server. Play your favorite tracks from multiple sources with seamless integration.

---

## Badges

![Discord.js](https://img.shields.io/badge/discord.js-v14-7289DA?logo=discord&logoColor=white)
![Node.js](https://img.shields.io/badge/node.js-20.x-339933?logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/license-ISC-blue.svg)
![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)

---

## Tech Stack

This project is built with the following technologies:

- **[Node.js](https://nodejs.org/)**: JavaScript runtime environment.
- **[Discord.js](https://discord.js.org/)**: The official Node.js module for interacting with the Discord API.
- **[@discordjs/voice](https://www.npmjs.com/package/@discordjs/voice)**: For managing voice connections in Discord.
- **[play-dl](https://www.npmjs.com/package/play-dl)**: For streaming audio from sources like YouTube, Spotify, and SoundCloud.
- **[FFmpeg](https://ffmpeg.org/)**: For processing audio data.
- **[Dotenv](https://www.npmjs.com/package/dotenv)**: For managing environment variables.
- **[Express](https://expressjs.com/)**: Web framework (used for health checks or a potential dashboard).

---

## Features

- **High-Quality Audio Streaming**: Enjoy crisp and clear music playback.
- **Multi-Source Support**: Play music from YouTube, Spotify, SoundCloud, and more.
- **Easy to Use**: Simple and intuitive commands for controlling music.
- **Queue System**: Add multiple songs to a queue and manage them easily.
- **Playback Control**: Play, pause, skip, and stop music on demand.
- **24/7 Music**: Keep the bot in a voice channel playing music indefinitely.

---

## Installation Guide

Follow these steps to set up the bot on your own server.

**Prerequisites:**
- [Node.js](https://nodejs.org/en/download/) (v16.9.0 or newer)
- [Git](https://git-scm.com/downloads)

**1. Clone the repository:**
```bash
git clone https://github.com/your-username/Bazzao_Discord_Music_Bot.git
cd Bazzao_Discord_Music_Bot
```

**2. Install dependencies:**
```bash
npm install
```

**3. Set up environment variables:**
Create a file named `.env` in the root directory of the project and add the following content:

```env
# Your Discord bot token from the Discord Developer Portal
DISCORD_TOKEN=your_bot_token_here

# Your Discord application/client ID
CLIENT_ID=your_client_id_here

# The ID of the server/guild for deploying commands
GUILD_ID=your_server_id_here
```

---

## Usage Instructions

Once the bot is running and invited to your server, you can use the following slash commands:

- `/play <song_name_or_url>`: Searches for a song and adds it to the queue.
- `/pause`: Pauses the current track.
- `/resume`: Resumes the paused track.
- `/skip`: Skips the current song and plays the next one in the queue.
- `/stop`: Stops the music and clears the queue.
- `/queue`: Displays the current list of songs in the queue.

**Example:**
To play a song, type the following command in a text channel:
```
/play Never Gonna Give You Up
```

---

## Configuration

All essential configurations are managed in the `.env` file. Make sure you have correctly set the `DISCORD_TOKEN`, `CLIENT_ID`, and `GUILD_ID` for the bot to function properly. No additional configuration is required.

---

## Screenshots / Demo

Here is a preview of the bot in action:

![Bot Command Example](https://via.placeholder.com/700x400.png?text=Bot+Command+Screenshot)
*Caption: Example of the /play command.*

![Music Queue](https://via.placeholder.com/700x400.png?text=Music+Queue+Screenshot)
*Caption: The music queue displayed in a channel.*

---

## Contact / Support

If you have any questions, encounter any issues, or need support, feel free to reach out:

- **Email**: [yeasararefin007@gmail.com](mailto:yeasararefin007@gmail.com)
- **Portfolio**: [yeasararefin.vercel.app](https://yeasararefin.vercel.app)
