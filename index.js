const express = require('express');
const app = express();
const port = process.env.PORT || 5000;
app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(port, () => console.log('Web server running'));

require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, demuxProbe } = require('@discordjs/voice');
const ytdl = require('youtube-dl-exec');
const playdl = require('play-dl');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Bot prefix
const PREFIX = '-';

// Store music queues and player states for each guild
const musicQueues = new Map();

class MusicQueue {
    constructor() {
        this.songs = []; // Current queue
        this.history = []; // History of played songs
        this.connection = null;
        this.player = null;
        this.isPlaying = false;
        this.currentChannel = null;
        this.loopMode = 'off'; // off, song, queue
        this.nowPlayingMessage = null;
        this.volume = 100;
        this.updateInterval = null; // For progress bar updates
        this.startTime = null; // Track when song started
        this.idleHandler = null; // Store idle handler reference
    }
}

client.once('ready', () => {
    console.log(`🎵 Logged in as ${client.user.tag}!`);
    console.log(`🎧 Use ${PREFIX}play <song> to play music!`);
});

// Handle message commands
client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const guildId = message.guild.id;

    if (!musicQueues.has(guildId)) {
        musicQueues.set(guildId, new MusicQueue());
    }

    const queue = musicQueues.get(guildId);
    queue.currentChannel = message.channel;

    switch (command) {
        case 'p':
        case 'play':
            await handlePlay(message, queue, args.join(' '));
            break;
        case 'stop':
            await handleStop(message, queue);
            break;
        case 'skip':
            await handleSkip(message, queue);
            break;
        case 'queue':
            await handleQueue(message, queue);
            break;
        case 'help':
            await handleHelp(message);
            break;
        case 'pause':
            await handlePause(message, queue);
            break;
        case 'resume':
            await handleResume(message, queue);
            break;
        case 'loop':
            await handleLoop(message, queue, args[0]);
            break;
        case 'volume':
            await handleVolume(message, queue, args[0]);
            break;
    }
});

// Handle button interactions
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const guildId = interaction.guild.id;
    const queue = musicQueues.get(guildId);
    if (!queue) return;

    const customId = interaction.customId;
    await interaction.deferUpdate();

    switch (customId) {
        case 'pause_resume':
            if (queue.player && queue.player.state.status === AudioPlayerStatus.Playing) {
                queue.player.pause();
            } else if (queue.player && queue.player.state.status === AudioPlayerStatus.Paused) {
                queue.player.unpause();
            }
            updateNowPlayingMessage(queue);
            break;
        case 'stop':
            handleStop(null, queue);
            break;
    }
});

async function handlePlay(message, queue, query) {
    if (!query) {
        return message.reply('Please provide a song name! Example: `-play never gonna give you up`');
    }

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
        return message.reply('You need to be in a voice channel to play music!');
    }

    const loadingMessage = await message.reply('🔍 Searching for song...');

    try {
        let songInfo;
        const isURL = playdl.yt_validate(query) === 'video';

        if (isURL) {
            // Get info using youtube-dl-exec
            const info = await ytdl(query, {
                dumpSingleJson: true,
                noWarnings: true,
                preferFreeFormats: true,
                addHeader: ['referer:youtube.com', 'user-agent:googlebot']
            });

            songInfo = {
                title: info.title,
                url: query,
                duration: info.duration,
                thumbnail: info.thumbnail
            };
        } else {
            // Search using play-dl
            const searchResults = await playdl.search(query, { limit: 1 });
            if (searchResults.length === 0) {
                return loadingMessage.edit('❌ No songs found!');
            }
            songInfo = {
                title: searchResults[0].title,
                url: searchResults[0].url,
                duration: searchResults[0].durationInSec,
                thumbnail: searchResults[0].thumbnails[0]?.url
            };
        }

        const song = {
            title: songInfo.title,
            url: songInfo.url,
            duration: songInfo.duration,
            requestedBy: message.author.tag,
            thumbnail: songInfo.thumbnail
        };

        queue.songs.push(song);

        if (!queue.connection) {
            queue.connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });

            queue.player = createAudioPlayer();
            queue.connection.subscribe(queue.player);

            // Create idle handler
            const idleHandler = () => {
                // Clear progress bar updates
                if (queue.updateInterval) {
                    clearInterval(queue.updateInterval);
                    queue.updateInterval = null;
                }

                // Only process if still connected
                if (!queue.connection) return;

                // Handle different loop modes
                if (queue.loopMode === 'song') {
                    // Replay same song without removing it
                    playNextSong(queue);
                } else {
                    // Move current song to history
                    const playedSong = queue.songs.shift();
                    if (playedSong) {
                        queue.history.push(playedSong);
                    }

                    // Add back to end if queue looping
                    if (queue.loopMode === 'queue' && playedSong) {
                        queue.songs.push(playedSong);
                    }

                    // Play next if songs remain
                    if (queue.songs.length > 0) {
                        playNextSong(queue);
                    } else {
                        // Stop if no songs left
                        handleStop(null, queue);
                    }
                }
            };

            // Store handler for skip functionality
            queue.idleHandler = idleHandler;
            queue.player.on(AudioPlayerStatus.Idle, idleHandler);

            // Error handling
            queue.player.on('error', error => {
                console.error('Audio Player Error:', error);
                if (queue.currentChannel) {
                    queue.currentChannel.send('❌ Player error. Skipping song...');
                }
                skipSong(queue);
            });
        }

        if (!queue.isPlaying) {
            playNextSong(queue);
            loadingMessage.edit(`✅ Now playing: **${song.title}**`);
        } else {
            loadingMessage.edit(`✅ Added to queue: **${song.title}**`);
        }
    } catch (error) {
        console.error('Play Command Error:', error);
        loadingMessage.edit(`❌ Error: ${error.message}`);
    }
}

async function playNextSong(queue) {
    if (queue.songs.length === 0 || !queue.connection) {
        queue.isPlaying = false;
        return;
    }

    const song = queue.songs[0];
    const maxRetries = 2;
    let retryCount = 0;
    let success = false;

    if (!queue.currentChannel) return;

    while (retryCount < maxRetries && !success) {
        try {
            console.log(`Playing: ${song.title} [Attempt ${retryCount + 1}]`);

            // Use youtube-dl-exec to stream audio directly
            const ytdlProcess = ytdl.exec(
                song.url,
                {
                    output: '-',
                    quiet: true,
                    format: 'bestaudio',
                    limitRate: '1M',
                    addHeader: ['referer:youtube.com', 'user-agent:googlebot'],
                    noCheckCertificates: true,
                    preferInsecure: true
                },
                { stdio: ['ignore', 'pipe', 'ignore'] }
            );

            if (!ytdlProcess.stdout) {
                throw new Error('Failed to create audio stream');
            }

            // Use demuxProbe to detect audio format
            const { stream, type } = await demuxProbe(ytdlProcess.stdout);

            // Create audio resource with detected type
            const resource = createAudioResource(stream, {
                inputType: type,
                inlineVolume: true
            });

            // Set volume
            resource.volume.setVolume(queue.volume / 100);

            queue.player.play(resource);
            queue.isPlaying = true;
            queue.startTime = Date.now(); // Track start time

            // Create or update now playing message
            updateNowPlayingMessage(queue);

            // Start progress bar updates
            startProgressBarUpdates(queue);

            success = true;
        } catch (error) {
            console.error(`Play Error [Attempt ${retryCount + 1}]:`, error);
            retryCount++;

            if (retryCount >= maxRetries) {
                let errorMsg = `❌ Failed to play: **${song.title}**`;

                if (error.message.includes('age restricted')) {
                    errorMsg += '\n🔞 Age-restricted content cannot be played.';
                } else if (error.message.includes('unavailable')) {
                    errorMsg += '\n🌍 Region blocked - Try using VPN.';
                } else if (error.message.includes('private') || error.message.includes('embedding disabled')) {
                    errorMsg += '\n🔒 Private video or embedding disabled.';
                } else {
                    errorMsg += `\n💻 Error: ${error.message}`;
                }

                if (queue.currentChannel) {
                    queue.currentChannel.send(errorMsg);
                }
                skipSong(queue);
            }
        }
    }
}

// Skip to next song in queue
function skipSong(queue) {
    if (queue.songs.length === 0) {
        handleStop(null, queue);
        return;
    }

    // Remove current song
    const skippedSong = queue.songs.shift();
    if (skippedSong) {
        queue.history.push(skippedSong);
    }

    // Play next song if available
    if (queue.songs.length > 0) {
        playNextSong(queue);
    } else {
        handleStop(null, queue);
    }
}

// Function to start progress bar updates
function startProgressBarUpdates(queue) {
    // Clear any existing interval
    if (queue.updateInterval) {
        clearInterval(queue.updateInterval);
    }

    // Set up a new interval to update the progress bar every 5 seconds
    queue.updateInterval = setInterval(() => {
        if (queue.player && queue.player.state.status === AudioPlayerStatus.Playing) {
            updateNowPlayingMessage(queue);
        }
    }, 5000);
}

async function updateNowPlayingMessage(queue) {
    if (queue.songs.length === 0 || !queue.player || !queue.currentChannel) return;

    const song = queue.songs[0];

    // Calculate current position
    let position = 0;
    if (queue.player.state.status === AudioPlayerStatus.Playing) {
        // Use playbackDuration for accurate position
        position = queue.player.state.playbackDuration / 1000;
    } else if (queue.startTime) {
        // Fallback to time-based calculation if needed
        position = (Date.now() - queue.startTime) / 1000;
    }

    const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('Now Playing')
        .setDescription(`**${song.title}**`)
        .setThumbnail(song.thumbnail)
        .addFields(
            {
                name: 'Duration',
                value: `${formatDuration(position)} / ${formatDuration(song.duration)}`,
                inline: true
            },
            {
                name: 'Requested by',
                value: song.requestedBy,
                inline: true
            },
        )
        .setFooter({
            text: `${queue.songs.length} song${queue.songs.length > 1 ? 's' : ''} in queue | ${queue.history.length} in history | Loop: ${queue.loopMode}`
        });

    // Progress bar
    const progressBarLength = 15;
    const progress = Math.min(1, position / song.duration);
    const progressBar = '▬'.repeat(progressBarLength);
    const progressPosition = Math.floor(progress * progressBarLength);
    const progressBarWithMarker = progressBar.substring(0, progressPosition) +
        '🔘' +
        progressBar.substring(progressPosition + 1);

    embed.addFields({
        name: 'Progress',
        value: progressBarWithMarker,
        inline: false
    });

    // Control buttons
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('pause_resume')
            .setEmoji(queue.player.state.status === AudioPlayerStatus.Playing ? '⏸️' : '▶️')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('stop')
            .setEmoji('⏹️')
            .setStyle(ButtonStyle.Secondary),
    );

    if (queue.nowPlayingMessage) {
        try {
            await queue.nowPlayingMessage.edit({
                embeds: [embed],
                components: [row]
            });
        } catch (error) {
            console.error('Error updating now playing message:', error);
            // Send a new message if editing fails
            queue.nowPlayingMessage = await queue.currentChannel.send({
                embeds: [embed],
                components: [row]
            });
        }
    } else {
        queue.nowPlayingMessage = await queue.currentChannel.send({
            embeds: [embed],
            components: [row]
        });
    }
}

async function handleStop(message, queue) {
    if (!queue.connection) {
        if (message) message.reply('❌ No music is currently playing!');
        return;
    }

    // Clear progress bar updates
    if (queue.updateInterval) {
        clearInterval(queue.updateInterval);
        queue.updateInterval = null;
    }

    // Remove idle handler
    if (queue.idleHandler && queue.player) {
        queue.player.off(AudioPlayerStatus.Idle, queue.idleHandler);
        queue.idleHandler = null;
    }

    // Clean up player and connection
    if (queue.player) {
        queue.player.stop();
        queue.player = null;
    }

    if (queue.connection) {
        queue.connection.destroy();
        queue.connection = null;
    }

    // Reset queue state
    queue.songs = [];
    queue.history = [];
    queue.isPlaying = false;
    queue.startTime = null;
    queue.loopMode = 'off';

    // Delete now playing message
    if (queue.nowPlayingMessage) {
        try {
            await queue.nowPlayingMessage.delete();
        } catch (error) {
            console.error('Error deleting now playing message:', error);
        }
        queue.nowPlayingMessage = null;
    }

    if (message) message.reply('⏹️ Music stopped and bot disconnected!');
}

async function handleSkip(message, queue) {
    if (!queue.player || queue.songs.length === 0) {
        if (message) message.reply('❌ No song to skip!');
        return;
    }

    // Clear progress bar updates
    if (queue.updateInterval) {
        clearInterval(queue.updateInterval);
        queue.updateInterval = null;
    }

    // Remove idle handler temporarily to prevent conflicts
    if (queue.idleHandler && queue.player) {
        queue.player.off(AudioPlayerStatus.Idle, queue.idleHandler);
    }

    // Stop current playback
    queue.player.stop();

    // Remove current song
    const skippedSong = queue.songs.shift();
    if (skippedSong) {
        queue.history.push(skippedSong);
    }

    if (queue.songs.length > 0) {
        // Play next song
        playNextSong(queue);
        if (message) {
            if (message.reply) {
                message.reply(`⏭️ Skipped **${skippedSong.title}**`);
            } else if (message.channel) {
                // Handle interaction response
                message.channel.send(`⏭️ Skipped **${skippedSong.title}**`);
            }
        }
    } else {
        // Stop the bot if no more songs
        handleStop(null, queue);
        if (message) {
            if (message.reply) {
                message.reply('⏭️ Skipped and stopped because queue is empty.');
            } else if (message.channel) {
                message.channel.send('⏭️ Skipped and stopped because queue is empty.');
            }
        }
    }

    // Reattach idle handler
    if (queue.idleHandler && queue.player) {
        queue.player.on(AudioPlayerStatus.Idle, queue.idleHandler);
    }
}

async function handlePause(message, queue) {
    if (!queue.player || queue.player.state.status !== AudioPlayerStatus.Playing) {
        message.reply('❌ No music is currently playing!');
        return;
    }

    queue.player.pause();
    message.reply('⏸️ Playback paused!');
    updateNowPlayingMessage(queue);
}

async function handleResume(message, queue) {
    if (!queue.player || queue.player.state.status !== AudioPlayerStatus.Paused) {
        message.reply('❌ Playback is not paused!');
        return;
    }

    queue.player.unpause();
    message.reply('▶️ Playback resumed!');
    updateNowPlayingMessage(queue);
}

async function handleLoop(message, queue, mode) {
    const validModes = ['off', 'song', 'queue'];
    if (!mode || !validModes.includes(mode)) {
        return message.reply('❌ Please specify loop mode: `off`, `song`, or `queue`');
    }

    queue.loopMode = mode;
    message.reply(`🔁 Loop mode set to: **${mode}**`);
    updateNowPlayingMessage(queue);
}

async function handleVolume(message, queue, volume) {
    const newVolume = parseInt(volume);
    if (isNaN(newVolume)) {
        return message.reply('❌ Please provide a valid volume number!');
    }

    if (newVolume < 0 || newVolume > 200) {
        return message.reply('❌ Volume must be between 0 and 200!');
    }

    queue.volume = newVolume;

    // Apply to current resource if playing
    if (queue.player && queue.player.state.status === AudioPlayerStatus.Playing) {
        const resource = queue.player.state.resource;
        if (resource && resource.volume) {
            resource.volume.setVolume(newVolume / 100);
        }
    }

    message.reply(`🔊 Volume set to: **${newVolume}%**`);
}

async function handleQueue(message, queue) {
    if (queue.songs.length === 0) {
        return message.reply('📭 The queue is empty!');
    }

    const queueList = queue.songs.slice(0, 10).map((song, index) => {
        const duration = song.duration ? formatDuration(song.duration) : 'Unknown';
        return `${index + 1}. **${song.title}** (${duration}) - Requested by ${song.requestedBy}`;
    }).join('\n');

    message.reply({
        embeds: [{
            color: 0x3498db,
            title: '🎵 Current Queue',
            description: queueList,
            footer: { text: `Total songs: ${queue.songs.length} | Loop: ${queue.loopMode}` }
        }]
    });
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

async function handleHelp(message) {
    const helpEmbed = {
        color: 0x0099ff,
        title: '🎵 Music Bot Commands',
        description: 'Here are all the available commands:',
        fields: [
            {
                name: `${PREFIX}play <song>`,
                value: 'Play a song by name',
                inline: false,
            },
            {
                name: `${PREFIX}stop`,
                value: 'Stop music and disconnect bot',
                inline: true,
            },
            {
                name: `${PREFIX}skip`,
                value: 'Skip current song',
                inline: true,
            },
            {
                name: `${PREFIX}pause`,
                value: 'Pause playback',
                inline: true,
            },
            {
                name: `${PREFIX}resume`,
                value: 'Resume playback',
                inline: true,
            },
            {
                name: `${PREFIX}loop <off/song/queue>`,
                value: 'Set loop mode',
                inline: true,
            },
            {
                name: `${PREFIX}volume <0-200>`,
                value: 'Set playback volume',
                inline: true,
            },
            {
                name: `${PREFIX}queue`,
                value: 'Show current queue',
                inline: true,
            },
            {
                name: `${PREFIX}help`,
                value: 'Show this help message',
                inline: true,
            }
        ],
        footer: {
            text: `Example: ${PREFIX}play never gonna give you up`,
        },
    };

    message.reply({ embeds: [helpEmbed] });
}

client.login(process.env.BOT_TOKEN);