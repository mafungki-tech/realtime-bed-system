const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Pool } = require('pg');
const { URL } = require('url'); // 引入 URL 解析器

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// --- 1. 資料庫連線設定 (已修正網路問題) ---
console.log("伺服器開始啟動 (版本 v3 - 網路修正)...");

if (!process.env.DATABASE_URL) {
    console.error("致命錯誤：環境變數 DATABASE_URL 未設定！");
    process.exit(1);
}

// 【核心修正】解析 DATABASE_URL 並強制使用主機名以優先選擇 IPv4
let dbConfig;
try {
    const dbUrl = new URL(process.env.DATABASE_URL);
    dbConfig = {
        user: dbUrl.username,
        password: dbUrl.password,
        host: dbUrl.hostname, // 使用 hostname 而不是依賴 URL 的直接解析
        port: dbUrl.port,
        database: dbUrl.pathname.slice(1), // 移除開頭的 '/'
        ssl: {
            rejectUnauthorized: false
        }
    };
    console.log(`正在使用主機名 '${dbConfig.host}' 建立資料庫連接池...`);
} catch (error) {
    console.error("致命錯誤：DATABASE_URL 格式不正確。", error);
    process.exit(1);
}

const pool = new Pool(dbConfig);

pool.on('connect', (client) => {
    console.log('✅ 資料庫連接池：一個新的客戶端已成功連接！');
});

pool.on('error', (err, client) => {
    console.error('❌ 資料庫連接池：發生未知錯誤', err);
});

// --- 2. 確保資料表存在的安全函數 ---
const ensureTableExists = async () => {
    const client = await pool.connect();
    console.log("正在檢查 'history' 資料表...");
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS history (
                id SERIAL PRIMARY KEY,
                timestamp BIGINT NOT NULL UNIQUE,
                state JSONB NOT NULL,
                time_string VARCHAR(255) NOT NULL
            );
        `);
        console.log("✅ 'history' 資料表已確認存在。");
    } catch (err) {
        console.error("❌ 致命錯誤：檢查或建立 'history' 資料表失敗！", err);
        throw err; // 拋出錯誤，讓主啟動函數捕獲
    } finally {
        client.release();
        console.log("資料表檢查完畢，已釋放資料庫客戶端。");
    }
};

// --- 3. Socket.IO 連線邏輯 ---
io.on('connection', async (socket) => {
    console.log(`一個新用戶連接上了 (Socket ID: ${socket.id})`);

    try {
        console.log(`[${socket.id}] 正在從資料庫讀取歷史紀錄...`);
        const result = await pool.query('SELECT * FROM history ORDER BY timestamp ASC');
        const historyLog = result.rows.map(row => ({
            timestamp: Number(row.timestamp),
            state: row.state,
            timeString: row.time_string
        }));
        console.log(`[${socket.id}] 成功讀取到 ${historyLog.length} 筆歷史紀錄。`);

        const latestLog = historyLog.length > 0 ? historyLog[historyLog.length - 1] : null;

        socket.emit('initialState', {
            state: latestLog ? latestLog.state : {},
            history: historyLog,
            time: latestLog ? latestLog.timeString : ''
        });
        console.log(`[${socket.id}] 已向用戶發送初始狀態。`);

    } catch (err) {
        console.error(`[${socket.id}] ❌ 錯誤：從資料庫讀取歷史紀錄失敗！`, err);
        socket.emit('error_message', '無法從伺服器獲取資料，請稍後再試。');
    }

    // 更新狀態
    socket.on('updateState', async (newState) => {
        const timestamp = Date.now();
        const timeString = new Date(timestamp).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' });
        console.log(`[${socket.id}] 收到 'updateState' 事件...`);

        try {
            const query = 'INSERT INTO history(timestamp, state, time_string) VALUES($1, $2, $3)';
            await pool.query(query, [timestamp, newState, timeString]);
            
            const result = await pool.query('SELECT * FROM history ORDER BY timestamp ASC');
            const fullHistory = result.rows.map(r => ({...r, timestamp: Number(r.timestamp)}));

            io.emit('stateChanged', {
                state: newState,
                history: fullHistory,
                time: timeString
            });
            console.log(`[${socket.id}] 成功寫入並廣播最新狀態。`);
        } catch (err) {
            console.error(`[${socket.id}] ❌ 錯誤：寫入資料庫失敗！`, err);
        }
    });

    // 其他事件監聽器 (undo, revertToTimestamp) 保持不變...
    socket.on('undo', async () => {
        console.log(`[${socket.id}] 收到 'undo' 事件...`);
        try {
            const res = await pool.query('SELECT id FROM history ORDER BY timestamp DESC LIMIT 1');
            if (res.rows.length > 0) {
                await pool.query('DELETE FROM history WHERE id = $1', [res.rows[0].id]);
            }
            const result = await pool.query('SELECT * FROM history ORDER BY timestamp ASC');
            const historyLog = result.rows.map(r => ({...r, timestamp: Number(r.timestamp)}));
            const latestLog = historyLog.length > 0 ? historyLog[historyLog.length - 1] : { state: {}, history: [], time: '' };
            io.emit('stateChanged', {
                state: latestLog.state || {},
                history: historyLog,
                time: latestLog.timeString || ''
            });
        } catch (err) {
            console.error(`[${socket.id}] 撤銷操作失敗:`, err);
        }
    });

    socket.on('revertToTimestamp', async (timestamp) => {
        console.log(`[${socket.id}] 收到 'revertToTimestamp' 事件...`);
        try {
            await pool.query('DELETE FROM history WHERE timestamp > $1', [Number(timestamp)]);
            const result = await pool.query('SELECT * FROM history ORDER BY timestamp ASC');
            const historyLog = result.rows.map(r => ({...r, timestamp: Number(r.timestamp)}));
            const targetLog = historyLog.length > 0 ? historyLog[historyLog.length - 1] : null;
            if (targetLog) {
                io.emit('stateChanged', {
                    state: targetLog.state,
                    history: historyLog,
                    time: targetLog.timeString
                });
            }
        } catch (err) {
            console.error(`[${socket.id}] 還原到指定時間點失敗:`, err);
        }
    });

    socket.on('disconnect', () => {
        console.log(`用戶斷開連接 (Socket ID: ${socket.id})`);
    });
});

// --- 4. 伺服器主啟動函數 ---
const startServer = async () => {
    try {
        await ensureTableExists(); // 啟動前，先安全地檢查資料表
        server.listen(PORT, () => {
            console.log(`✅✅✅ 伺服器已成功啟動並穩定運行，正在監聽 port ${PORT} ✅✅✅`);
        });
    } catch (err) {
        console.error("❌❌❌ 伺服器啟動過程中發生致命錯誤，無法啟動！", err);
        process.exit(1); // 確保在啟動失敗時，進程會退出
    }
};

startServer();