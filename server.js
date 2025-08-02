const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// 讓伺服器可以提供前端的靜態檔案 (例如 index.html)
app.use(express.static(__dirname));

// --- 伺服器的核心狀態管理 ---
// 這就是我們的「官方狀態總表」，儲存在伺服器的記憶體中
// 在真實的應用中，這裡會被資料庫取代
let history = []; 

// 當有新的使用者連線時執行的程式碼
io.on('connection', (socket) => {
    console.log(`一個使用者連線了: ${socket.id}`);

    // 1. 當新使用者連上時，立刻將最新的歷史狀態傳送給他
    if (history.length > 0) {
        socket.emit('state-update', history[history.length - 1]);
    }

    // 2. 監聽來自客戶端的「床位點擊」事件
    socket.on('bed-state-change', (newSnapshot) => {
        console.log('收到新的床位狀態:', newSnapshot);
        // 將新的狀態快照加入歷史紀錄
        history.push(newSnapshot);
        // 向「所有」連線的客戶端廣播這個最新的狀態
        io.emit('state-update', newSnapshot);
    });

    // 3. 監聽來自客戶端的「復原」事件
    socket.on('undo-request', () => {
        if (history.length > 0) {
            console.log('收到復原請求，移除最後一筆紀錄');
            history.pop(); // 移除最後一筆
            const previousState = history.length > 0 ? history[history.length - 1] : { state: [] };
            // 向「所有」客戶端廣播「復原後」的狀態
            io.emit('state-update', previousState);
        }
    });

    // 當使用者斷線時
    socket.on('disconnect', () => {
        console.log(`使用者斷線了: ${socket.id}`);
    });
});

server.listen(PORT, () => {
    console.log(`伺服器正在 http://localhost:${PORT} 上運行`);
});