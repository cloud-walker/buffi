import { type Faker, faker } from "@faker-js/faker";
import { isNumber } from "remeda";

/**
 * Let you quickly spin up an entity factory function with fake data + overrides.
 *
 * @example
 * const myEntity = makeEntityFactory<{ id: number; foo: string }>((id, F) => ({
 *  id,
 *  foo: F.lorem.sentence(),
 * }));
 */
export function makeEntityFactory<T>(
  fakeResolver: (id: number, faker: Faker) => T,
) {
  let id = 1;
  const factory = Object.assign(
    (overrides?: Partial<T>): T => {
      return { ...fakeResolver(id++, faker), ...overrides };
    },
    {
      /**
       * You can use this method to quickly generate a list of the entity that you want.
       */
      list(
        opts: {
          count?: number | readonly [number, number];
          overrides?: () => Partial<T>;
        } = {},
      ): T[] {
        return faker.helpers.multiple(() => factory(opts.overrides?.()), {
          count:
            opts.count == null
              ? opts.count
              : isNumber(opts.count)
                ? opts.count
                : { min: opts.count[0], max: opts.count[1] },
        });
      },
    },
  );
  return factory;
}
