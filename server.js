const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// --- 伺服器端資料儲存 ---
// bedState 的結構將是: { '1': 'on', '2': 'off', '19A': 'on', ... }
let bedState = {}; 
// historyLog 的結構將是: { timestamp: 123, state: {'1':'on', ...}, timeString: '...' }
let historyLog = []; 
let lastUpdateTime = new Date();

// 初始化所有床位為 'off' 狀態
const bedIds = [
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15',
    '16', '17', '18', '19', '19A', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29',
    '30', '31', '32', '33', '34', '34A', '35', '36', '36A', '37', '38', '39', '40', '41', '42', '43', '43A', '44'
];
bedIds.forEach(id => {
    bedState[id] = 'off';
});

// 讓伺服器可以提供 public 資料夾中的靜態檔案 (例如 index.html)
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
    console.log('一個新用戶連接上了');

    // 1. 當新用戶連接時，立即發送當前的完整床位狀態和過濾後的歷史紀錄
    socket.emit('initialState', {
        state: bedState,
        history: historyLog,
        time: lastUpdateTime.toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })
    });

    // 2. 監聽來自客戶端的狀態變更請求
    socket.on('updateState', (newState) => {
        // 更新伺服器上的狀態
        bedState = newState;
        lastUpdateTime = new Date();

        // 建立一條新的歷史紀錄
        const logEntry = {
            timestamp: lastUpdateTime.getTime(),
            state: { ...bedState }, // 儲存當前狀態的完整副本
            timeString: lastUpdateTime.toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })
        };
        
        historyLog.push(logEntry);

        // 過濾掉超過24小時的歷史紀錄
        const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
        historyLog = historyLog.filter(entry => entry.timestamp >= twentyFourHoursAgo);

        // 向所有連接的客戶端廣播【完整的】新狀態
        io.emit('stateChanged', {
            state: bedState,
            history: historyLog,
            time: logEntry.timeString
        });
    });

    // 3. 監聽來自客戶端的撤銷請求
    socket.on('undo', () => {
        // 必須有超過一筆紀錄才能撤銷 (回到上一筆)
        if (historyLog.length > 1) {
            historyLog.pop(); // 移除最新的一筆紀錄
            const previousLog = historyLog[historyLog.length - 1];
            bedState = previousLog.state; // 恢復到上一筆紀錄的狀態
            lastUpdateTime = new Date(previousLog.timestamp);

            // 廣播【完整的】恢復後狀態
            io.emit('stateChanged', {
                state: bedState,
                history: historyLog,
                time: lastUpdateTime.toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('一個用戶斷開連接了');
    });
});

server.listen(PORT, () => {
    console.log(`伺服器正在 http://localhost:${PORT} 上運行`);
});