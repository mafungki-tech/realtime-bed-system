const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

let bedState = {}; 
let historyLog = []; 
let lastUpdateTime = new Date();

const bedIds = [
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15',
    '16', '17', '18', '19', '19A', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29',
    '30', '31', '32', '33', '34', '34A', '35', '36', '36A', '37', '38', '39', '40', '41', '42', '43', '43A', '44'
];
bedIds.forEach(id => {
    bedState[id] = 'off';
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
    console.log('一個新用戶連接上了');

    socket.emit('initialState', {
        state: bedState,
        history: historyLog,
        time: lastUpdateTime.toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })
    });

    socket.on('updateState', (newState) => {
        bedState = newState;
        lastUpdateTime = new Date();

        const logEntry = {
            timestamp: lastUpdateTime.getTime(),
            state: { ...bedState }, 
            timeString: lastUpdateTime.toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })
        };
        
        historyLog.push(logEntry);

        const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
        historyLog = historyLog.filter(entry => entry.timestamp >= twentyFourHoursAgo);

        io.emit('stateChanged', {
            state: bedState,
            history: historyLog,
            time: logEntry.timeString
        });
    });

    socket.on('undo', () => {
        // 只有當歷史紀錄超過一筆時才執行 (保留初始狀態)
        if (historyLog.length > 1) {
            historyLog.pop(); 
            const previousLog = historyLog[historyLog.length - 1];
            bedState = previousLog.state; 
            lastUpdateTime = new Date(previousLog.timestamp);

            io.emit('stateChanged', {
                state: bedState,
                history: historyLog,
                time: lastUpdateTime.toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })
            });
        }
    });

    // --- 【新功能】處理回到指定時間點的請求 ---
    socket.on('revertToTimestamp', (timestamp) => {
        const targetTimestamp = Number(timestamp);
        
        // 找到該時間點在歷史紀錄中的索引
        const targetIndex = historyLog.findIndex(log => log.timestamp === targetTimestamp);

        if (targetIndex !== -1) {
            // 恢復到該時間點的狀態
            bedState = historyLog[targetIndex].state;
            
            // 刪除該時間點之後的所有歷史紀錄
            historyLog = historyLog.slice(0, targetIndex + 1);
            
            lastUpdateTime = new Date(targetTimestamp);

            // 向所有客戶端廣播恢復後的狀態
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