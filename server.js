const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// --- 1. 資料庫連線設定 (更詳細的日誌) ---
console.log("伺服器開始啟動...");

if (!process.env.DATABASE_URL) {
    console.error("致命錯誤：環境變數 DATABASE_URL 未設定！請在 Render.com 的後台設定。");
    process.exit(1); // 如果沒有設定資料庫地址，直接退出
}

console.log("正在建立資料庫連接池...");
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.on('connect', () => {
    console.log('資料庫連接池：一個新的客戶端已連接');
});

pool.on('error', (err, client) => {
    console.error('資料庫連接池：發生未知錯誤', err);
    process.exit(-1);
});

console.log("資料庫連接池建立完畢。");

// --- 2. 確保資料表存在的安全函數 ---
const ensureTableExists = async () => {
    const client = await pool.connect(); // 從連接池取一個客戶端
    console.log("正在檢查 'history' 資料表是否存在...");
    try {
        const query = `
            CREATE TABLE IF NOT EXISTS history (
                id SERIAL PRIMARY KEY,
                timestamp BIGINT NOT NULL UNIQUE,
                state JSONB NOT NULL,
                time_string VARCHAR(255) NOT NULL
            );
        `;
        await client.query(query);
        console.log("成功：'history' 資料表已確認存在，且不會被清空。");
    } catch (err) {
        console.error("致命錯誤：檢查或建立 'history' 資料表失敗！", err);
        // 如果連資料表都無法建立，後續操作無意義
        process.exit(1);
    } finally {
        client.release(); // 無論成功或失敗，都必須釋放客戶端回連接池
        console.log("資料表檢查完畢，已釋放資料庫客戶端。");
    }
};

// --- 3. Socket.IO 連線邏輯 (強化錯誤處理) ---
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
        console.error(`[${socket.id}] 致命錯誤：從資料庫讀取歷史紀錄失敗！`, err);
        // 可以選擇向客戶端發送一個錯誤訊息
        socket.emit('error_message', '無法從伺服器獲取資料，請稍後再試。');
    }

    // 更新狀態
    socket.on('updateState', async (newState) => {
        const timestamp = Date.now();
        const timeString = new Date(timestamp).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' });
        console.log(`[${socket.id}] 收到 'updateState' 事件，準備寫入新紀錄...`);

        try {
            const query = 'INSERT INTO history(timestamp, state, time_string) VALUES($1, $2, $3)';
            await pool.query(query, [timestamp, newState, timeString]);
            console.log(`[${socket.id}] 成功將新紀錄寫入資料庫。`);
            
            // 廣播給所有用戶
            io.emit('stateChanged', {
                state: newState,
                history: (await pool.query('SELECT * FROM history ORDER BY timestamp ASC')).rows.map(r => ({...r, timestamp: Number(r.timestamp)})),
                time: timeString
            });
            console.log(`[${socket.id}] 已向所有用戶廣播最新狀態。`);
        } catch (err) {
            console.error(`[${socket.id}] 致命錯誤：寫入資料庫失敗！`, err);
        }
    });

    // 撤銷操作
    socket.on('undo', async () => {
        console.log(`[${socket.id}] 收到 'undo' 事件...`);
        // ... (撤銷和還原的邏輯保持不變，但可以加入更多日誌)
        try {
            const res = await pool.query('SELECT id FROM history ORDER BY timestamp DESC LIMIT 1');
            if (res.rows.length > 0) {
                await pool.query('DELETE FROM history WHERE id = $1', [res.rows[0].id]);
                console.log(`[${socket.id}] 成功從資料庫刪除最新一筆紀錄。`);
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

    // 還原到指定時間點
    socket.on('revertToTimestamp', async (timestamp) => {
        console.log(`[${socket.id}] 收到 'revertToTimestamp' 事件，目標時間戳: ${timestamp}`);
        // ... (同樣可以加入更多日誌)
        try {
            await pool.query('DELETE FROM history WHERE timestamp > $1', [Number(timestamp)]);
            console.log(`[${socket.id}] 成功刪除目標時間點之後的所有紀錄。`);
            const result = await pool.query('SELECT * FROM history ORDER BY timestamp ASC');
            const historyLog = result.rows.map(r => ({...r, timestamp: Number(r.timestamp)}));
            const targetLog = historyLog[historyLog.length - 1];
            io.emit('stateChanged', {
                state: targetLog.state,
                history: historyLog,
                time: targetLog.timeString
            });
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
            console.log(`✅ 伺服器成功啟動，正在監聽 port ${PORT}`);
        });
    } catch (err) {
        console.error("❌ 伺服器啟動失敗！", err);
    }
};

startServer();