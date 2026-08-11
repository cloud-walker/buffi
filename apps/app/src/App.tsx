import { css } from '~/css'

import { appStore, Provider, TableView, useRow } from './appStore'
import { raise } from './helpers/raise'

export function App() {
	return (
		<Provider store={appStore}>
			<ul
				className={css({
					padding: '4',
					textStyle: 'xl',
				})}
			>
				<TableView tableId="expense" rowComponent={ExpenseRow} />
			</ul>
		</Provider>
	)
}

const formatter = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' })

function ExpenseRow(props: { rowId: string }) {
	const expense =
		useRow('expense', props.rowId) ?? raise(`No expense found for expense ${props.rowId}`)
	return (
		<li
			className={css({
				color: 'blue.400',
			})}
		>
			{expense.title} - {formatter.format(expense.amount)}
		</li>
	)
}
