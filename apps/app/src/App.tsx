import * as R from 'remeda'
import { faker } from '@faker-js/faker'

import { css } from "../styled-system/css";

interface ExpenseEntity {
  id: string
  title: string
  amount: number
}

export function App() {
  return (
    <div
      className={css({
        textStyle: "2xl",
      })}
    >
      {R.pipe(faker.helpers.multiple(() => makeExpenseEntity()), R.map(ex => {
        return <div key={ex.id}>{ JSON.stringify(ex)}</div>
      }))}
    </div>
  );
}

function makeExpenseEntity(overrides?: Partial<ExpenseEntity>): ExpenseEntity {
  return {
    id: faker.string.uuid(),
    title: faker.commerce.productName(),
    amount: faker.number.float(),
  }
}
