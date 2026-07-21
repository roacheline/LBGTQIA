// Lucky Tab Module
// Made by fishergirlana

import request from "requestV2";
import Promise from "PromiseV2";

const displayStringCache = new Map();
const CACHE_DURATION = 86400 * 7 * 1000; // 7 days
const MY_CACHE_DURATION = 86400 * 1000; // 1 day
const MY_UUID = "78acba39-3ce1-49f6-8855-f9bca5907432";

const FETCH_TIMEOUT = 10000;
const FETCH_COOLDOWN = 1000;
const CACHE_SAVE_INTERVAL = 20 * 60 * 1000;
const CACHE_FILE_PATH = "config/ChatTriggers/modules/lucky_tab/cache.json";
const ENV_FILE_PATH = "config/ChatTriggers/modules/lucky_tab/.env";


function loadEnv() {
    const env = {};
    try {
        const content = FileLib.read(ENV_FILE_PATH);
        if (content === "" || content === null) {
            return env;
        }

        content.split(/\r?\n/).forEach(rawLine => {
            const line = rawLine.trim();
            if (line === "" || line.startsWith("#")) return;

            const eq = line.indexOf("=");
            if (eq === -1) return;

            const key = line.substring(0, eq).trim();
            let value = line.substring(eq + 1).trim();

            if (value.length >= 2 &&
                ((value.startsWith('"') && value.endsWith('"')) ||
                 (value.startsWith("'") && value.endsWith("'")))) {
                value = value.substring(1, value.length - 1);
            }

            if (key) env[key] = value;
        });
    } catch (error) {
        console.log("error ", error);
    }
    return env;
}

let API_KEY = loadEnv().HYPIXEL_API_KEY || "";

let HEART = "❤"

let FRIENDS = [
    {
        uuid: "f4bee4a9-c1ca-4b92-9563-f4f8148b2968",
        color: "7"
    },
    {
        uuid: "18fe5844-ce24-4d11-ad34-35c96435900f",
        color: "2"
    },
    {
        uuid: "78acba39-3ce1-49f6-8855-f9bca5907432",
        color: "b"
    },
    {
        uuid: "12d31ed9-3348-46a2-9b0d-e70a55143671",
        color: "d"
    },
    {
        uuid: "4653e749-5b13-42ed-ab51-d0749cc2ddae",
        color: "5"
    },
    {
        uuid: "be019b4c-beb8-4dc8-950b-4a8991a86adb",
        color: "7"
    },
    {
        uuid: "3457688a-a57c-4d71-ab9d-22b04f9160db",
        color: "3"
    },
]

let isFetching = false;
let lastFetchTime = 0;
let globalTimeoutId = null;
let lastCacheSaveTime = 0;

let fetchedThisInstance = false;

const headErrorLogged = new Set();

let guiForHeads = null;
try {
    guiForHeads = new (Java.type("net.minecraft.client.gui.Gui"))();
} catch (e) {
    console.log("could not create instance for head rendering ", e);
}// have to use forge obfuscated here because chattriggers HATES me!!!
// https://github.com/KevyPorter/Minecraft-Forge-Utils/blob/master/methods.csv
function drawPlayerHead(mcPlayer, uuid, x, y, size) {
    if (!mcPlayer || !guiForHeads) return false;
    try {
        const skin = mcPlayer.func_110306_p();
        if (!skin) return false;

        Client.getMinecraft().func_110434_K().func_110577_a(skin);// https://github.com/KevyPorter/Minecraft-Forge-Utils/blob/master/methods.csv

        Tessellator.enableTexture2D();
        Tessellator.enableBlend();
        Tessellator.tryBlendFuncSeparate(770, 771, 1, 0);
        Tessellator.colorize(1, 1, 1, 1);

        const ix = Math.round(x);
        const iy = Math.round(y);
        const s = Math.round(size);

        guiForHeads.func_152125_a(ix, iy, 8, 8, 8, 8, s, s, 64, 64);
        guiForHeads.func_152125_a(ix, iy, 40, 8, 8, 8, s, s, 64, 64);
        return true;
    } catch (e) {
        if (!headErrorLogged.has(uuid)) {
            headErrorLogged.add(uuid);
            console.log(`Head render error for ${uuid}:`, e);
            ChatLib.chat(`&c[head] render failed (${uuid}): ${e}`);
        }
        return false;
    }
}

/**
 * Loads the cache from disk
 */
function loadCacheFromDisk() {
    try {
        const fileContent = FileLib.read(CACHE_FILE_PATH);

        if (fileContent === "" || fileContent === null) {
            ChatLib.chat("&e[Cache] No cache file found, starting with empty cache.");
            return;
        }

        const cacheData = JSON.parse(fileContent);
        let loadedCount = 0;

        Object.keys(cacheData).forEach(uuid => {
            const entry = cacheData[uuid];

            displayStringCache.set(uuid, {
                displayString: entry.displayString,
                altDisplayString: entry.altDisplayString,
                wins: entry.wins,
                timestamp: entry.timestamp
            });
            loadedCount++;
        });

        ChatLib.chat(`&a[Cache] Loaded ${loadedCount} entries from cache file.`);
    } catch (error) {
        ChatLib.chat(`&c[Cache] Error loading cache: ${error.message}`);
        console.log("Cache load error:", error);
    }
}

/**
 * Saves the cache to disk
 */
function saveCacheToDisk() {
    try {
        const now = Date.now();
        const cacheObject = {};
        let savedCount = 0;

        displayStringCache.forEach((value, key) => {
            cacheObject[key] = {
                displayString: value.displayString,
                altDisplayString: value.altDisplayString,
                wins: value.wins,
                timestamp: value.timestamp
            };
            savedCount++;
        });

        FileLib.write(CACHE_FILE_PATH, JSON.stringify(cacheObject, null, 2));
        lastCacheSaveTime = now;

        ChatLib.chat(`&a[Cache] Saved ${savedCount} entries to cache file.`);
    } catch (error) {
        ChatLib.chat(`&c[Cache] Error saving cache: ${error.message}`);
        console.log("Cache save error:", error);
    }
}

function createTimeout(callback, delay) {
    const startTime = Date.now();
    const timeoutId = { cancelled: false };

    const tickHandler = register("tick", () => {
        if (timeoutId.cancelled) {
            tickHandler.unregister();
            return;
        }

        if (Date.now() - startTime >= delay) {
            callback();
            tickHandler.unregister();
            timeoutId.cancelled = true;
        }
    });

    return timeoutId;
}

function cancelTimeout(timeoutId) {
    if (timeoutId) {
        timeoutId.cancelled = true;
    }
}

register("command", () => {
    fetchAllPlayersData();
}).setName("fetch");

// 餀餁餂餂餃餄餅
let luckyBlockIcons = [
    { wins: 0, icon: "餀", color_code: "§9" },
    { wins: 5, icon: "餁", color_code: "§2" },
    { wins: 25, icon: "餂", color_code: "§e" },
    { wins: 100, icon: "餃", color_code: "§6" },
    { wins: 250, icon: "餄", color_code: "§c" },
    { wins: 1000, icon: "餅", color_code: "§b" },
    { wins: 3000, icon: "餆", color_code: "§d" },
    { wins: 10000, icon: "餇", color_code: "§5" }
];

luckyBlockIcons.sort((a, b) => b.wins - a.wins);

function getLuckyBlockWins(playerData) {
    if (!playerData || playerData.nicked) return 0;
    return (playerData?.stats?.SkyWars?.lab_win_lucky_blocks_lab) || 0;
}

/**
 * Formats a player's data into a display string
 * @param {Object} playerData The player data from Hypixel API
 * @returns {string} Formatted display string
 */
function formatPlayerDisplayString(playerData) {
    if (playerData.nicked) {
        return "§cNICKED §7◉ ???";
    }

    let skywarsLevel = playerData?.stats?.SkyWars?.levelFormattedWithBrackets || "§7???✯";
    skywarsLevel = skywarsLevel.replace(/[\[\]]/g, "");
    const luckyBlockWins = getLuckyBlockWins(playerData);

    const luckyBlockIcon = luckyBlockIcons.find(icon => luckyBlockWins >= icon.wins);
    const luckyBlockIconString = luckyBlockIcon
        ? `${luckyBlockIcon.color_code}${formatNumberWithCommas(luckyBlockWins)} §f${luckyBlockIcon.icon}`
        : `??? ${luckyBlockWins}`;

    return `${skywarsLevel}§7◉ ${luckyBlockIconString}`;
}

function formatPlayerAltDisplayString(playerData) {
    if (playerData.nicked) {
        return "§c??? §7◉ NICKED";
    }

    let skywarsLevel = playerData?.stats?.SkyWars?.levelFormattedWithBrackets || "§7???✯";
    skywarsLevel = skywarsLevel.replace(/[\[\]]/g, "");
    const luckyBlockWins = getLuckyBlockWins(playerData);

    const luckyBlockIcon = luckyBlockIcons.find(icon => luckyBlockWins >= icon.wins);
    const luckyBlockIconString = luckyBlockIcon
        ? `${luckyBlockIcon.icon} ${luckyBlockIcon.color_code}${formatNumberWithCommas(luckyBlockWins)}`
        : `??? ${luckyBlockWins}`;

    const trimmedSkywarsLevel = skywarsLevel.replace(/\s+$/g, '');

    return `${luckyBlockIconString} §7◉ ${trimmedSkywarsLevel}`;
}

/**
 * Fetches player data from Hypixel API with timeout
 * @param {string} uuid Player UUID
 * @returns {Promise<string>} Formatted display string
 */
function fetchPlayerData(uuid) {
    const uuidStr = String(uuid);

    if (!API_KEY) {
        return Promise.reject("No API key set");
    }

    const cached = displayStringCache.get(uuidStr);
    if (
        cached &&
        Date.now() - cached.timestamp < CACHE_DURATION &&
        cached.altDisplayString &&
        typeof cached.wins === "number"
    ) {
        return Promise.resolve(cached.displayString);
    }

    const timeoutPromise = new Promise((resolve, reject) => {
        createTimeout(() => {
            reject(new Error(`Request timed out after ${FETCH_TIMEOUT/1000} seconds`));
        }, FETCH_TIMEOUT);
    });

    const fetchPromise = request({
        url: `https://api.hypixel.net/player?uuid=${uuidStr}`,
        headers: {
            'API-Key': API_KEY
        },
        json: true
    }).then(response => {
        if (!response.success) {
            throw new Error(response.cause || 'Unknown error');
        }

        if (!response.player) {
            ChatLib.chat(`&c[Debug] API returned success but no player data!`);
            response.player = {
                nicked: true,
            }
        }

        const displayString = formatPlayerDisplayString(response.player);
        const altDisplayString = formatPlayerAltDisplayString(response.player);
        const wins = getLuckyBlockWins(response.player);

        let timestamp = Date.now();
        if (uuidStr === MY_UUID) {
            timestamp -= CACHE_DURATION - MY_CACHE_DURATION;
        }

        displayStringCache.set(uuidStr, {
            displayString: displayString,
            altDisplayString: altDisplayString,
            wins: wins,
            timestamp: timestamp
        });

        const now = Date.now();
        if (now - lastCacheSaveTime > CACHE_SAVE_INTERVAL) {
            saveCacheToDisk();
        }

        return displayString;
    });

    return Promise.race([fetchPromise, timeoutPromise])
        .catch(error => {
            if (error.message && error.message.includes("timed out")) {
                ChatLib.chat(`&c[Timeout] Request for ${uuidStr} timed out`);
            } else if (error.cause) {
                ChatLib.chat(`&cAPI Error: ${error.cause}`);
            } else if (error.message) {
                ChatLib.chat(`&cError: ${error.message}`);
            } else {
                console.log("Full error object:", JSON.stringify(error, null, 2));
                ChatLib.chat("&can unknown error occurred check the console for details");
            }
            throw error;
        });
}

/**
 * Fetches data for all players in the world
 */
function fetchAllPlayersData() {
    const now = Date.now();

    if (!API_KEY) {
        ChatLib.chat("&cNo API key set! Use /setapikey <key> to set your Hypixel API key.");
        return;
    }

    if (isFetching) {
        ChatLib.chat("&cAlready fetching player data, please wait...");
        return;
    }

    if (now - lastFetchTime < FETCH_COOLDOWN) {
        const remainingSeconds = Math.ceil((FETCH_COOLDOWN - (now - lastFetchTime)) / 1000);
        ChatLib.chat(`&cPlease wait ${remainingSeconds} seconds before fetching again.`);
        return;
    }

    isFetching = true;
    lastFetchTime = now;
    fetchedThisInstance = true;
    ChatLib.chat("&aFetching player data for all visible players...");

    const players = World.getAllPlayers();
    if (!players || players.length === 0) {
        ChatLib.chat("&cNo players found in the world!");
        isFetching = false;
        return;
    }

    ChatLib.chat(`&e[Debug] Found ${players.length} players in the world`);

    let toFetch = 0;
    let fetched = 0;
    let failed = 0;

    if (globalTimeoutId) {
        cancelTimeout(globalTimeoutId);
    }

    globalTimeoutId = createTimeout(() => {
        if (isFetching) {
            ChatLib.chat(`&c[Timeout] Fetch operation timed out after ${FETCH_TIMEOUT*2/1000} seconds`);
            ChatLib.chat(`&cFetched ${fetched} players, ${failed} failed, ${toFetch-fetched-failed} pending`);
            isFetching = false;
            globalTimeoutId = null;
        }
    }, FETCH_TIMEOUT * 2);

    players.forEach(player => {
        if (player.getUUID() === Player.getUUID()) return;

        const uuid = player.getUUID();
        if (!uuid) {
            ChatLib.chat(`&c[Debug] No UUID for player ${player.getName()}`);
            return;
        }

        const uuidStr = String(uuid);

        const uuidUndashed = uuidStr.replace(/-/g, "");
        if (uuidUndashed[12] == "2") {
            ChatLib.chat(`&e[Debug] Skipping NPC ${player.getName()} (${uuidStr})`);
            return;
        }

        ChatLib.chat(`&e[Debug] Will fetch data for ${player.getName()} (${uuidStr})`);
        toFetch++;

        fetchPlayerData(uuidStr)
            .then(displayString => {
                ChatLib.chat(`&a[Debug] Successfully fetched data for ${player.getName()}`);
                fetched++;
                checkCompletion();
            })
            .catch(error => {
                ChatLib.chat(`&c[Debug] Failed to fetch data for ${player.getName()}: ${error}`);
                failed++;
                checkCompletion();
            });
    });

    function checkCompletion() {
        if (fetched + failed === toFetch) {
            ChatLib.chat(`&aFinished fetching all player data! Success: ${fetched}, Failed: ${failed}`);
            isFetching = false;

            saveCacheToDisk();

            if (globalTimeoutId) {
                cancelTimeout(globalTimeoutId);
                globalTimeoutId = null;
            }
        }
    }

    if (toFetch === 0) {
        ChatLib.chat("&cNo players to fetch data for!");
        isFetching = false;
        if (globalTimeoutId) {
            cancelTimeout(globalTimeoutId);
            globalTimeoutId = null;
        }
    }
}

function getCachedWins(uuid) {
    const cached = displayStringCache.get(uuid);
    if (!cached) return null;
    if (typeof cached.wins === "number") return cached.wins;

    const match = cached.displayString && cached.displayString.match(/([\d,]+)\s*§f/);
    return match ? parseInt(match[1].replace(/,/g, ""), 10) : 0;
}
// https://github.com/KevyPorter/Minecraft-Forge-Utils/blob/master/methods.csv
function getTabScore(playerName) {
    try {
        const world = World.getWorld();
        if (!world) return null;

        const scoreboard = world.func_96441_U(); // https://github.com/KevyPorter/Minecraft-Forge-Utils/blob/1c25243aadcc4deaf79429aedd9d1bbceac84ca5/methods.csv#L2800
        if (!scoreboard) return null;

        const objective = scoreboard.func_96539_a(0);
        if (!objective) return null;

        const score = scoreboard.func_96529_a(playerName, objective);
        if (!score) return null;

        return score.func_96652_c();
    } catch (e) {
        return null;
    }
}

function getEffectiveColor(str) { // gets color code that human sees
    if (!str) return null;
    let color = null;
    const re = /[§&]([0-9a-fk-orA-FK-OR])/g;
    let m;
    while ((m = re.exec(str)) !== null) {
        const c = m[1].toLowerCase();
        if (c === "r") color = null;
        else if ("0123456789abcdef".indexOf(c) !== -1) color = c;
    }
    return color;
}

function isSpectator(player) {
    try {
        const team = player.getTeam();
        if (!team) return false;
        return getEffectiveColor(team.getPrefix()) === "7";
    } catch (e) {
        return false;
    }
}

const TAB_BG_COLOR = Renderer.color(0, 0, 0, 160); // change to black
const TAB_ROW_COLOR = Renderer.color(255, 255, 255, 20);

register("worldUnload", () => {
    fetchedThisInstance = false;
    headErrorLogged.clear();
});

register("renderPlayerList", (event) => {
    if (!fetchedThisInstance) return;
    if (!World.isLoaded()) return;

    const players = World.getAllPlayers();
    if (!players || players.length === 0) return;

    const rows = [];
    players.forEach(player => {
        try {
            const uuid = String(player.getUUID());

            if (uuid.replace(/-/g, "")[12] === "2") return;

            const cached = displayStringCache.get(uuid);

            const friend = FRIENDS.find(f => f.uuid === uuid); // adds ticher and ana
            const heart = friend ? `§${friend.color}${HEART} ` : "";

            let entity = null;
            try { entity = player.getPlayer(); } catch (e) { entity = null; }

            const hp = getTabScore(player.getName());

            const spectator = isSpectator(player);
            const nameColor = spectator ? "§7§m" : "§f";
            const colB = `${heart}${nameColor}${player.getName()}`;

            if (cached && cached.displayString) {
                const tabString = cached.altDisplayString || cached.displayString;

                rows.push({
                    uuid: uuid,
                    wins: getCachedWins(uuid) || 0,
                    uncached: false,
                    spectator: spectator,
                    entity: entity,
                    colA: tabString,
                    colB: colB,
                    hp: hp
                });
            } else {
                rows.push({
                    uuid: uuid,
                    wins: -1,
                    uncached: true,
                    spectator: spectator,
                    entity: entity,
                    colA: "§7§o???",
                    colB: colB,
                    hp: hp
                });
            }
        } catch (e) {
            console.log("tab error:", e);
        }
    });

    if (rows.length === 0) return;

    cancel(event);

    rows.sort((a, b) => {
        if (a.spectator !== b.spectator) return a.spectator ? 1 : -1;
        if (a.uncached !== b.uncached) return a.uncached ? 1 : -1;
        return b.wins - a.wins;
    });

    const aliveCount = rows.filter(r => !r.spectator).length; // should remove dead people but if not we may need to filter further
    const title = `§3Lucky Blocks §r§7(${aliveCount} alive)`;

    const rowHeight = 10;
    const headSize = 8;
    const headGap = 2;
    const paddingX = 4;
    const paddingY = 3;
    const textIndent = headSize + headGap;
    const colGap = 4;

    let maxColA = 0;
    let maxColB = 0;
    let maxHp = 0;
    rows.forEach(r => {
        r.hpText = (r.hp === null || r.hp === undefined) ? "" : `§e${r.hp}`; // use hearts instead of hp nvm
        maxColA = Math.max(maxColA, Renderer.getStringWidth(r.colA));
        maxColB = Math.max(maxColB, Renderer.getStringWidth(r.colB));
        maxHp = Math.max(maxHp, Renderer.getStringWidth(r.hpText));
    });

    const colAX = textIndent;
    const colBX = colAX + maxColA + colGap;
    const hasHp = maxHp > 0;
    const colCEnd = colBX + maxColB + (hasHp ? colGap + maxHp : 0);

    const contentWidth = Math.max(colCEnd, Renderer.getStringWidth(title));
    const boxWidth = contentWidth + paddingX * 2;
    const boxHeight = (rows.length + 1) * rowHeight + paddingY * 2;

    const startX = (Renderer.screen.getWidth() - boxWidth) / 2;
    const startY = 10;
    const contentX = startX + paddingX;
    const hpRightEdge = contentX + colCEnd;

    Renderer.drawRect(TAB_BG_COLOR, startX, startY, boxWidth, boxHeight);

    Renderer.drawStringWithShadow(
        title,
        startX + (boxWidth - Renderer.getStringWidth(title)) / 2,
        startY + paddingY
    );

    rows.forEach((r, i) => {
        const y = startY + paddingY + (i + 1) * rowHeight;
        if (i % 2 === 1) {
            Renderer.drawRect(TAB_ROW_COLOR, startX, y - 1, boxWidth, rowHeight);
        }
        drawPlayerHead(r.entity, r.uuid, contentX, y, headSize);
        Renderer.drawStringWithShadow(r.colA, contentX + colAX, y);
        Renderer.drawStringWithShadow(r.colB, contentX + colBX, y);
        if (r.hpText) {
            Renderer.drawStringWithShadow(r.hpText, hpRightEdge - Renderer.getStringWidth(r.hpText), y);
        }
    });
});

/**
 * Format a number with commas
 * @param {number} number The number to format
 * @returns {string} Formatted number
 */
function formatNumberWithCommas(number) {
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

register("worldLoad", () => {
    loadCacheFromDisk();
});

loadCacheFromDisk();

ChatLib.chat("&atype /fetch");
