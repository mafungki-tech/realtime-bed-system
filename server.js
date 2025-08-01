const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;
app.use(express.static(__dirname));
let history = []; 
io.on('connection', (socket) => {
    console.log(`一個使用者連線了: ${socket.id}`);
    if (history.length > 0) {
        socket.emit('state-update', history[history.length - 1]);
    }
    socket.on('bed-state-change', (newSnapshot) => {
        console.log('收到新的床位狀態:', newSnapshot);
        history.push(newSnapshot);
        io.emit('state-update', newSnapshot);
    });
    socket.on('undo-request', () => {
        if (history.length > 0) {
            console.log('收到復原請求，移除最後一筆紀錄');
            history.pop();
            const previousState = history.length > 0 ? history[history.length - 1] : { state: [] };
            io.emit('state-update', previousState);
        }
    });
    socket.on('disconnect', () => {
        console.log(`使用者斷線了: ${socket.id}`);
    });
});
server.listen(PORT, () => {
    console.log(`伺服器正在 http://localhost:${PORT} 上運行`);
});