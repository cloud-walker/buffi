import { createWsServer } from 'tinybase/synchronizers/synchronizer-ws-server'
import { WebSocketServer } from 'ws'
import { z } from 'zod'

const port = z.coerce.number().int().min(1).parse(process.env.PORT)
const wsServer = new WebSocketServer({
	port,
})
const server = createWsServer(wsServer)

wsServer.on('listening', () => {
	console.log(`sync server listening on ws://localhost:${port}`)
})

process.on('SIGINT', () => handleShutdown('SIGINT'))
process.on('SIGTERM', () => handleShutdown('SIGTERM'))

async function handleShutdown(signal: NodeJS.Signals) {
	console.log(`${signal} received, shutting down sync server...`)
	await server.destroy()
	process.exit(0)
}
