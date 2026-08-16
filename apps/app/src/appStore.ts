import { faker } from '@faker-js/faker'
import * as R from 'remeda'
import { createOpfsPersister } from 'tinybase/persisters/persister-browser/with-schemas'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client/with-schemas'
import * as TBReact from 'tinybase/ui-react/with-schemas'
import { createMergeableStore, type NoValuesSchema } from 'tinybase/with-schemas'

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
export const appStore = createMergeableStore()
	.setTablesSchema(appStoreTablesSchema)
	.setTable(
		'expense',
		R.pipe(
			makeExpense.list({ count: [1, 10] }),
			R.map((ex) => [ex.id, ex] as const),
			R.fromEntries(),
		),
	)
const rootDir = await navigator.storage.getDirectory()
const handle = await rootDir.getFileHandle('app-store.json', { create: true })
const persister = createOpfsPersister(appStore, handle)
await persister.startAutoPersisting()

createWsSynchronizer(appStore, new WebSocket('ws://localhost:8080')).then((s) => {
	s.startSync()
})

export const { useCell, useRow, TableView, CellView, Provider } = TBReact as TBReact.WithSchemas<
	[typeof appStoreTablesSchema, NoValuesSchema]
>
