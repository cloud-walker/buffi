import { css } from '~/css'

import { appStore, makeExpense, Provider, TableView, useRow } from './appStore'
import { raise } from './helpers/raise'

export function App() {
	return (
		<Provider store={appStore}>
			<div
				className={css({
					padding: '4',
				})}
			>
				<ul
					className={css({
						textStyle: 'xl',
					})}
				>
					<TableView tableId="expense" rowComponent={ExpenseRow} />
				</ul>
				<button
					type="button"
					onClick={() => {
						appStore.addRow('expense', makeExpense())
					}}
				>
					Add Expense
				</button>
			</div>
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
				color: 'green.400',
			})}
		>
			{expense.title} - {formatter.format(expense.amount)}
		</li>
	)
}
