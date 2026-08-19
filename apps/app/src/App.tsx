import { css } from '~/css'

import { appStore, makeExpense, Provider, SortedTableView, useRow } from './appStore'
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
					<SortedTableView tableId="expense" cellId="createdAt" rowComponent={ExpenseRow} />
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

const priceFormatter = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' })
const dateFormatter = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium' })

function ExpenseRow(props: { rowId: string }) {
	const expense =
		useRow('expense', props.rowId) ?? raise(`No expense found for expense ${props.rowId}`)
	return (
		<li
			className={css({
				color: 'green.400',
			})}
		>
			{expense.title} - {priceFormatter.format(expense.amount)} -{' '}
			{dateFormatter.format(new Date(expense.createdAt))}
		</li>
	)
}
