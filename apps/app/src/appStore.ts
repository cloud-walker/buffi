import { faker } from '@faker-js/faker'
import { createOpfsPersister } from 'tinybase/persisters/persister-browser/with-schemas'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client/with-schemas'
import * as TBReact from 'tinybase/ui-react/with-schemas'
import { createMergeableStore, type NoValuesSchema } from 'tinybase/with-schemas'
import { z } from 'zod'

import { makeEntityFactory } from './helpers/make-entity-factory.mock'

interface ExpenseEntity {
	id: string
	title: string
	amount: number
}
export const makeExpense = makeEntityFactory<ExpenseEntity>((id) => ({
	id: `expense_${id}`,
	title: faker.commerce.productName(),
	amount: faker.number.float({ min: 0, max: 100 }),
}))

const appStoreTablesSchema = {
	expense: {
		id: { type: 'string', required: true },
		title: { type: 'string', required: true },
		amount: { type: 'number', required: true },
	},
} as const
export const appStore = createMergeableStore().setTablesSchema(appStoreTablesSchema)
const rootDir = await navigator.storage.getDirectory()
const handle = await rootDir.getFileHandle('app-store.json', { create: true })
const persister = createOpfsPersister(appStore, handle)
await persister.startAutoPersisting()

const syncUrl = z.url().parse(import.meta.env.VITE_SYNC_WS_URL)
createWsSynchronizer(appStore, new WebSocket(`${syncUrl}/expense`))
	.then((s) => s.startSync())
	.catch((err) => {
		/**
		 * @todo, we probably need a way to track those errors
		 */
		console.error(err)
	})

export const { useCell, useRow, TableView, CellView, Provider } = TBReact as TBReact.WithSchemas<
	[typeof appStoreTablesSchema, NoValuesSchema]
>
