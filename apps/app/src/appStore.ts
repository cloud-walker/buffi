import { faker } from '@faker-js/faker'
import { createOpfsPersister } from 'tinybase/persisters/persister-browser/with-schemas'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client/with-schemas'
import * as TBReact from 'tinybase/ui-react/with-schemas'
import {
	type CellSchema,
	createMergeableStore,
	type NoValuesSchema,
	type TablesSchema,
} from 'tinybase/with-schemas'
import { z } from 'zod'

import { makeEntityFactory } from './helpers/make-entity-factory.mock'

interface ExpenseEntity {
	id: string
	title: string
	amount: number
	createdAt: number
}
export const makeExpense = makeEntityFactory<ExpenseEntity>((id) => ({
	id: `expense_${id}`,
	title: faker.commerce.productName(),
	amount: faker.number.float({ min: 0, max: 100 }),
	createdAt: Date.now(),
}))

const UNKNOWN_TIMESTAMP = 0
const appStoreTablesSchema = {
	expense: {
		id: { type: 'string', required: true },
		title: { type: 'string', required: true },
		amount: { type: 'number', required: true },
		createdAt: { type: 'number', required: true, default: UNKNOWN_TIMESTAMP },
	} as const satisfies Record<keyof ExpenseEntity, CellSchema>,
} as const satisfies TablesSchema
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

export const { useCell, useRow, TableView, CellView, Provider, SortedTableView } =
	TBReact as TBReact.WithSchemas<[typeof appStoreTablesSchema, NoValuesSchema]>
