import { createWsServer } from 'tinybase/synchronizers/synchronizer-ws-server'
import { WebSocketServer } from 'ws'

const wsServer = new WebSocketServer({
	port: 8080,
})
const server = createWsServer(wsServer)

wsServer.on('listening', () => {
	console.log(`sync server listening on ws://localhost:${8080}`)
})

process.on('SIGINT', () => handleShutdown('SIGINT'))
process.on('SIGTERM', () => handleShutdown('SIGTERM'))

async function handleShutdown(signal: NodeJS.Signals) {
	console.log(`${signal} received, shutting down sync server...`)
	await server.destroy()
	process.exit(0)
}
