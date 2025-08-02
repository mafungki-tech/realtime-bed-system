// 引入必要的模組
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

// 初始化應用
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 設定靜態檔案目錄，讓伺服器可以提供 index.html
app.use(express.static(path.join(__dirname)));

// --- 核心資料結構升級 ---

const totalBeds = 20;
const bedStatus = {}; // 床位狀態物件
const historyLog = []; // 全域的歷史紀錄陣列

// 初始化所有床位的狀態
for (let i = 1; i <= totalBeds; i++) {
    bedStatus[i] = {
        status: 'available', // 'available', 'occupied', 'cleaning'
        timestamp: new Date() // 每個床位都帶有自己的時間戳
    };
}

// --- Socket.IO 連線邏輯 ---

io.on('connection', (socket) => {
    console.log('一個新用戶連接成功！');

    // 1. 當新用戶連線時，立即發送「完整的當前床位狀態」和「完整的歷史紀錄」
    socket.emit('initialStatus', bedStatus);
    socket.emit('historyLog', historyLog);

    // 2. 監聽來自客戶端的 'changeStatus' 事件
    socket.on('changeStatus', (data) => {
        const { bedId, newStatus } = data;
        const timestamp = new Date(); // 取得當前的伺服器時間

        if (bedStatus[bedId]) {
            // 更新床位狀態和時間戳
            bedStatus[bedId] = {
                status: newStatus,
                timestamp: timestamp
            };

            // 建立一個新的歷史紀錄項目
            const logEntry = {
                bedId: bedId,
                newStatus: newStatus,
                timestamp: timestamp
            };

            // 將新紀錄添加到歷史紀錄陣列的「最前面」，以便客戶端顯示
            historyLog.unshift(logEntry);
            
            // 如果歷史紀錄超過100條，可以移除最舊的紀錄以節省記憶體 (可選)
            if (historyLog.length > 100) {
                historyLog.pop();
            }

            // 3. 向所有連接的客戶端廣播「狀態變更」和「新的單條歷史紀錄」
            io.emit('statusChange', { bedId, newStatus, timestamp: timestamp.toISOString() });
            io.emit('newHistoryEntry', logEntry);

            console.log(`床位 ${bedId} 狀態更新為 ${newStatus}`);
        }
    });

    // 監聽斷開連線事件
    socket.on('disconnect', () => {
        console.log('一個用戶已斷開連線');
    });
});

// --- 啟動伺服器 ---

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`伺服器正在 http://localhost:${PORT} 上運行`);
});