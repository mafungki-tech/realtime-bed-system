const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// 將資料儲存在伺服器記憶體中
let bedStatus = {}; // 儲存每個床位的狀態 { 'bed-1': 'occupied', ... }
let historyLog = []; // 儲存歷史操作紀錄
let lastUpdateTime = new Date(); // 儲存最後更新時間

// 初始化床位狀態 (如果需要預設值)
for (let i = 1; i <= 20; i++) {
    bedStatus[`bed-${i}`] = 'available';
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
    console.log('一個新用戶連接上了');

    // 當新用戶連接時，立即發送當前的所有床位狀態、歷史紀錄和最後更新時間
    socket.emit('initialStatus', {
        beds: bedStatus,
        history: historyLog,
        time: lastUpdateTime.toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })
    });

    // 監聽來自客戶端的狀態變更請求
    socket.on('changeStatus', (data) => {
        const { bedId, newStatus, oldStatus } = data;
        
        // 更新伺服器上的狀態
        bedStatus[bedId] = newStatus;
        lastUpdateTime = new Date();

        // 建立一條新的歷史紀錄
        const logEntry = {
            timestamp: Date.now(),
            bedId: bedId,
            oldStatus: oldStatus,
            newStatus: newStatus,
            timeString: lastUpdateTime.toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })
        };
        
        // 將新紀錄添加到歷史紀錄的開頭
        historyLog.unshift(logEntry);

        // **核心功能：過濾掉超過24小時的歷史紀錄**
        const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
        historyLog = historyLog.filter(entry => entry.timestamp >= twentyFourHoursAgo);

        // 向所有連接的客戶端廣播狀態更新
        io.emit('statusUpdate', { bedId, newStatus });
        
        // 向所有客戶端廣播全新的歷史紀錄
        io.emit('updateHistory', historyLog);

        // 向所有客戶端廣播更新時間
        io.emit('updateTime', lastUpdateTime.toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' }));
    });

    // 監聽來自客戶端的撤銷請求
    socket.on('undo', () => {
        if (historyLog.length > 0) {
            const lastAction = historyLog.shift(); // 移除並獲取最新的一條紀錄
            
            // 恢復到上一個狀態
            bedStatus[lastAction.bedId] = lastAction.oldStatus;
            lastUpdateTime = new Date();

            // 廣播被恢復的床位狀態
            io.emit('statusUpdate', { bedId: lastAction.bedId, newStatus: lastAction.oldStatus });
            
            // 廣播更新後的歷史紀錄 (已經移除了最後一條)
            io.emit('updateHistory', historyLog);

            // 廣播更新時間
            io.emit('updateTime', lastUpdateTime.toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' }));
        }
    });

    socket.on('disconnect', () => {
        console.log('一個用戶斷開連接了');
    });
});

server.listen(PORT, () => {
    console.log(`伺服器正在 http://localhost:${PORT} 上運行`);
});