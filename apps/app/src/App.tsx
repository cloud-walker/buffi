import * as R from "remeda";
import { faker } from "@faker-js/faker";

import { css } from "~/css";
import { makeEntityFactory } from "./helpers/make-entity-factory.mock";

interface ExpenseEntity {
  id: string;
  title: string;
  amount: number;
}

export function App() {
  return (
    <div
      className={css({
        padding: "4",
        textStyle: "xl",
      })}
    >
      {R.pipe(
        expense.list({ count: [1, 10] }),
        R.map((ex) => {
          return (
            <div
              key={ex.id}
              className={css({
                padding: "4",
              })}
            >
              {JSON.stringify(ex)}
            </div>
          );
        }),
      )}
    </div>
  );
}

const expense = makeEntityFactory<ExpenseEntity>((id) => ({
  id: `expense_${id}`,
  title: faker.commerce.productName(),
  amount: faker.number.float(),
}));
