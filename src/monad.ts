import {
  Either,
  Failure,
  Success,
  MatchCondition,
  MatchOptions,
  MatchMode,
  NamedMonad,
  RetryOptions,
  FoldResult,
  ErrorType,
  HttpError,
} from "./util";

export class Monad<T, E = Error> {
  /**
   * @param value The value
   */
  constructor(private value: Promise<Either<T, E>>) {}

  // ---- Static methods ----

  /**
   * Creates a new monad containing the value
   *
   * @param value The value
   * @param error The error
   * @returns {Monad<T, E>} A monad containing the value
   *
   * @template T The type of the value
   * @template E The type of the error
   * @example
   * const monad = Monad.of(1); // monad contains 1
   * const monad = Monad.of(1, new Error("Something went wrong")); // monad contains an error
   *
   */
  static of<T, E = Error>(value: T, error?: E): Monad<T, E> {
    if (error) {
      return new Monad(Promise.resolve(new Failure(error)));
    }
    return new Monad(Promise.resolve(new Success(value)));
  }

  /**
   * Creates a new monad containing the value
   *
   * @param promise The promise to wrap
   * @returns {Monad<T, E>} A monad containing the value
   *
   * @template T The type of the value
   * @template E The type of the error
   * @example
   * const monad = Monad.fromPromise(Promise.resolve(1)); // monad contains 1
   * const monad = Monad.fromPromise(Promise.reject(new Error("Something went wrong"))); // monad contains an error
   */
  static fromPromise<T, E = Error>(promise: Promise<T>): Monad<T, E> {
    return new Monad<T, E>(
      promise
        .then((value) => new Success(value) as Either<T, E>)
        .catch((error) => new Failure(error as E) as Either<T, E>),
    );
  }

  /**
   * Creates a new promise that resolves to the value of the monad
   *
   * @returns {Promise<T>} A promise that resolves to the value of the monad
   * @example
   * const monad = Monad.of(1);
   * const value = await monad.toPromise(); // value === 1
   */
  async toPromise(): Promise<T> {
    return this.value.then((either) =>
      either.isSuccess() ? Promise.resolve(either.value) : Promise.reject(either.error),
    );
  }

  /**
   * Creates a new monad that resolves to Failure
   *
   * @param error The error
   * @returns {Monad<T, E>} A monad containing the error
   *
   * @template T The type of the value
   * @template E The type of the error
   * @example
   * const monad = Monad.fail(new Error("Something went wrong")); // monad contains an error
   */
  static fail<T, E>(error: E): Monad<T, E> {
    return new Monad(Promise.resolve(new Failure(error)));
  }

  /**
   * Creates a new monad from an array of monads
   *
   * @param monads An array of monads
   * @returns {Monad<T[], E>} A monad containing an array of values
   *
   * @template T The type of the value
   * @template E The type of the error
   * @example
   * const monad1 = Monad.of(1);
   * const monad2 = Monad.of(2);
   * const monad12 = Monad.zip(monad1, monad2); // monad12 contains { 0: 1, 1: 2 }
   */
  static zip<T extends any[], E = Error>(monads: NamedMonad<T[number], E>[]): Monad<{ [key: string]: T[number] }, E>;
  /**
   * Creates a new monad from an array of monads
   *
   * @param monads Multiple arrays of monads
   * @returns {Monad<T[], E>} A monad containing an array of values
   *
   * @template T The type of the value
   * @template E The type of the error
   * @example
   * const monad1 = Monad.of(1);
   * const monad2 = Monad.of(2);
   * const monad123 = Monad.zip([monad1, monad2]); // monad123 contains { 0: 1, 1: 2 }
   */
  static zip<T extends any[], E = Error>(...monads: NamedMonad<T[number], E>[]): Monad<{ [key: string]: T[number] }, E>;
  /**
   * Creates a new monad from multiple values
   *
   * @param monads Either an array of monads or multiple arrays of monads
   * @returns {Monad<T[], E>} A monad containing an array of values
   *
   * @template T The type of the value
   * @template E The type of the error
   * @example
   * const monad123 = Monad.zip(1, 2, 3); // monad123 contains { 0: 1, 1: 2, 2: 3 }
   */
  static zip<T extends any[], E = Error>(...monads: any[]): Monad<{ [key: string]: T[number] }, E> {
    const monadArray = Array.isArray(monads[0]) ? [...monads[0]] : monads;
    return new Monad(
      Promise.all(monadArray.map((m: NamedMonad<T[number], E>) => m.monad.yield())).then((results) => {
        let error: E | null = null;
        const combinedValue = results.reduce(
          (acc, result, i) => {
            const key = monadArray[i].name || `m${i}`;
            if (result.isSuccess()) acc[key] = result.value;
            else if (error === null) error = result.error;
            return acc;
          },
          {} as { [key: string]: T[number] },
        );
        if (error) {
          return new Failure(error);
        }
        return new Success(combinedValue);
      }),
    );
  }

  /**
   * Retries an operation a number of times
   *
   * @param operationFn A function that returns a monad
   * @param options Options for the retry operation, @see RetryOptions
   * @returns {Monad<T, E>} A monad containing the result of the operation
   *
   * @template T The type of the value
   * @template E The type of the error
   * @example
   * const monad = Monad.retry(() => Monad.of(1), { times: 3 }); // monad contains 1
   * const monad = Monad.retry(() => Monad.fail(new Error("Something went wrong")), { times: 3 }); // monad contains an error
   */
  static retry<T, E = Error>(operationFn: () => Monad<T, E>, options: RetryOptions<E>): Monad<T, E> {
    const { times = 1, delay = 1000, backoffFactor = 1, onError } = options;
    const retryOperation = async (retriesLeft: number, currentDelay: number): Promise<Either<T, E>> => {
      const operation = operationFn();
      const result = await operation.yield();
      if (result.isSuccess() || retriesLeft <= 0) return result;
      if (onError && result.error) onError(result.error, times - retriesLeft);
      // Artificially delay the retry
      await new Promise((resolve) => setTimeout(resolve, currentDelay));

      return retryOperation(retriesLeft - 1, currentDelay * backoffFactor);
    };
    return new Monad(retryOperation(times, delay));
  }

  /**
   * Sets a timeout for an operation
   *
   * @param operation A function that returns a monad
   * @param duration  The duration of the timeout in milliseconds
   * @param timeoutError The error to return if the timeout is reached
   * @returns  {Monad<T, E>} A monad containing the result of the operation
   *
   * @template T The type of the value
   * @template E The type of the error
   * @example
   * const monad = Monad.timeout(() => Monad.of(1), 1000, new Error("Timeout")); // monad contains 1
   * const monad = Monad.timeout(() => Monad.fail(new Error("Something went wrong")), 1000, new Error("Timeout")); // monad contains an error
   */
  static timeout<T, E = Error>(
    operation: (abortSignal?: AbortSignal) => Monad<T, E>,
    duration: number,
    timeoutError: E,
  ): Monad<T, E> {
    return new Monad<T, E>(
      new Promise<Either<T, E>>((resolve) => {
        const abortController = new AbortController();
        let isAbortSupported = true;

        const timer = setTimeout(() => {
          if (isAbortSupported) {
            abortController.abort();
          }
          resolve(new Failure(timeoutError));
        }, duration);
        operation(abortController.signal)
          .yield()
          .then((result) => {
            if (result.isSuccess()) {
              clearTimeout(timer);
              resolve(result);
            } else if (result.error instanceof DOMException && result.error.name === "AbortError") {
              isAbortSupported = false;
              // Let the timeout handler take care of this
            } else {
              clearTimeout(timer);
              resolve(result);
            }
          })
          .catch((error) => {
            clearTimeout(timer);
            resolve(new Failure(error));
          });
      }),
    );
  }

  /**
   * Measures the execution time of an operation
   *
   * @param operation  The operation to measure
   * @param logger A logger to log the result of the operation, @default console.log
   * @param transformer A function that transforms the result of the operation into a log message, @default (duration, result) => `Execution took ${duration.toFixed(2)}ms - Error: ${result.error}`
   * @returns {Promise<Either<T, E>>} A promise that resolves to the result of the operation
   *
   * @template T The type of the value
   * @template E The type of the error
   * @template L The type of the logger
   * @example
   * const monad = Monad.timeExecution(() => Monad.of(1)); // monad contains 1
   * const monad = Monad.timeExecution(() => Monad.fail(new Error("Something went wrong"))); // monad contains an error
   */
  static async timeExecution<T, E = Error, L = Console>(
    operation: () => Monad<T, E>,
    logger: L,
    transformer?: (duration: number, result: Either<T, E>) => string,
  ): Promise<Either<T, E>> {
    const startTime = performance.now();
    const result = await operation().yield();
    const endTime = performance.now();
    const duration = endTime - startTime;

    let message = `Execution took ${duration.toFixed(2)}ms`;
    if (transformer) {
      message = transformer(duration, result);
    } else if (!result.isSuccess()) {
      message += ` - Error: ${result.error}`; // Include error information in the log message
    }
    if (logger && typeof (logger as any).log === "function") (logger as any).log(message);
    else console.log(message);
    return result;
  }

  // ---- Instance methods ----

  /**
   * Maps the value of the monad to a new value. If the value is a promise, it will be awaited.
   * If the value is a failure, the failure will be propagated. If the mapping function throws an error,
   * the error will be propagated as a failure.
   *
   * @param fn The mapping function
   * @returns {Monad<U, E>} A monad containing the mapped value
   *
   * @template U The type of the mapped value
   * @example
   * const monad = Monad.of(1);
   * const mappedMonad = monad.map(value => value + 1); // mappedMonad contains 2
   * const monad = Monad.fail(new Error("Something went wrong"));
   * const mappedMonad = monad.map(value => value + 1); // mappedMonad contains an error
   */
  map<U>(fn: (value: T) => U): Monad<U, E> {
    return new Monad(
      this.value.then((either) =>
        either.isSuccess()
          ? Promise.resolve()
              .then(() => fn(either.value))
              .then((value) => new Success(value) as Either<U, E>)
              .catch((error) => new Failure(error instanceof Error ? error.message : error) as Either<U, E>)
          : (new Failure(either.error) as Either<U, E>),
      ),
    );
  }

  /**
   * Works the same as map, but the mapping function can return a monad. If the mapping function returns a promise,
   * it will be awaited. If the mapping function throws an error, the error will be propagated as a failure.
   * @see map
   *
   * @param fn The mapping function
   * @returns {Monad<U, E>} A monad containing the mapped value
   *
   * @template U The type of the mapped value
   * @example
   * const monad = Monad.of(1);
   * const mappedMonad = monad.flatMap(value => Monad.of(value + 1)); // mappedMonad contains 2
   * const monad = Monad.fail(new Error("Something went wrong"));
   * const mappedMonad = monad.flatMap(value => Monad.of(value + 1)); // mappedMonad contains an error
   * const monad = Monad.of(1);
   * const mappedMonad = monad.flatMap(value => Monad.fail(new Error("Something went wrong"))); // mappedMonad contains an error
   */
  flatMap<U>(fn: (value: T) => U | Promise<U> | Monad<U, E>): Monad<U, E> {
    return new Monad(
      this.value.then((either) =>
        either.isSuccess()
          ? Promise.resolve()
              .then(() => fn(either.value))
              .catch((error) => new Failure(error instanceof Error ? error.message : error) as Either<U, E>)
              .then((value) => {
                if (value instanceof Monad) {
                  return value.yield().then((innerEither) => innerEither as Either<U, E>);
                } else if (value instanceof Promise) {
                  return value
                    .then((result) => new Success(result) as Either<U, E>)
                    .catch((error) => new Failure(error) as Either<U, E>);
                } else if (value instanceof Failure) {
                  return value as Either<U, E>;
                } else {
                  return new Success(value) as Either<U, E>;
                }
              })
          : Promise.resolve(new Failure(either.error) as Either<U, E>),
      ),
    );
  }

  /**
   * Returns the value of the monad if it is a success, otherwise returns the alternative value.
   *
   * @param fn The function that returns the alternative value
   * @returns {Monad<T, E>} A monad containing the value
   *
   * @template U The type of the alternative value
   * @example
   * const monad = Monad.of(1);
   * const value = monad.recover(() => 2); // value === 1
   * const monad = Monad.fail(new Error("Something went wrong"));
   * const value = monad.recover(error => 1); // value === 1
   */
  recover(fn: (error: E) => T): Monad<T, E> {
    return new Monad(
      this.value.then((either) => (either.isSuccess() ? either : (new Success(fn(either.error)) as Either<T, E>))),
    );
  }

  /**
   * Returns the value of the monad if it is a success, otherwise returns the alternative value or monad.
   * Works similarly to recover, but the alternative value can be a monad.
   *
   * @param alternative The alternative value or monad
   * @returns {Monad<T, E>} A monad containing the value
   *
   * @template U The type of the alternative value
   * @example
   * const monad = Monad.of(1);
   * const value = monad.orElse(2); // value === 1
   * const monad = Monad.fail(new Error("Something went wrong"));
   * const value = monad.orElse(2); // value === 2
   */
  orElse(alternative: Monad<T, E> | ((error: E) => Monad<T, E>)): Monad<T, E> {
    return new Monad(
      this.value.then((either) =>
        either.isSuccess()
          ? either
          : (typeof alternative === "function" ? alternative(either.error) : alternative).yield(),
      ),
    );
  }

  /**
   * Matches a value against a set of conditions. If a condition matches, the action is executed and the result is returned.
   * If no condition matches, the monad is returned. If continueIfNoMatch is true, the monad is returned if no condition matches.
   * If continueOnError is true, the monad is returned if an error occurs during the execution of an action.
   *
   * @param conditions An array of conditions or a single condition, @see MatchCondition
   * @param options @see MatchOptions
   *  - continueIfNoMatch: @default false
   *  - mode: @default MatchMode.FIRST
   *  - continueOnError: @default false
   * @returns {Monad<T, E>} A monad containing the result of the action
   * 
   * @example
   * const monad = Monad.of(1);
   * const matchedMonad = monad.match([
   *  { condition: value => value === 1, action: value => value + 1 },
   *  { condition: value => value === 2, action: value => value + 2 },
   * ]); // matchedMonad contains 2
   */
  match(
    conditions: MatchCondition<T, E>[] | MatchCondition<T, E>,
    options: MatchOptions = {
      continueIfNoMatch: false,
      mode: MatchMode.FIRST,
      continueOnError: false,
    },
  ): Monad<T, E> {
    return new Monad(
      this.value.then(async (either) => {
        if (either.isSuccess()) {
          const conditionsArray = Array.isArray(conditions) ? conditions : [conditions];
          let matched = false;
          for (const condition of conditionsArray) {
            if (condition.condition(either.value)) {
              matched = true;
              try {
                const actionResult = await condition.action(either.value);
                if (options.mode === MatchMode.FIRST) {
                  return new Success(actionResult) as Either<T, E>;
                }
              } catch (error) {
                if (options.continueOnError) return either;
                return new Failure(error instanceof Error ? error.message : error) as Either<T, E>;
              }
            }
          }
          if (!matched && !options.continueIfNoMatch) {
            return new Failure("No conditions matched") as Either<T, E>;
          } else if (matched || options.continueIfNoMatch) {
            return either;
          }
        }
        return either;
      }),
    );
  }

  /**
   * Filters the value of the monad. If the value is a promise, it will be awaited.
   * 
   * @param predicate The predicate function, @see Array.filter
   * @param errorFn A function that returns the error to use if the predicate returns false
   * @returns {Monad<T, E>} A monad containing the filtered value
   * 
   * @template E2 The type of the error
   * @example
   * const monad = Monad.of(1);
   * const filteredMonad = monad.filter(value => value === 1); // filteredMonad contains 1
   * const monad = Monad.of(1);
   * const filteredMonad = monad.filter(value => value === 2); // filteredMonad contains an error
   * const monad = Monad.fail(new Error("Something went wrong"));
   * const filteredMonad = monad.filter(value => value === 1); // filteredMonad contains an error
   */
  filter<E2 = E>(
    predicate: (value: T) => boolean | Promise<boolean>,
    errorFn: (value: T) => E2 = () => "Value did not satisfy the predicate" as any as E2,
  ): Monad<T, E | E2> {
    return new Monad<T, E | E2>(
      this.value.then(async (either) => {
        if (!either.isSuccess()) return either;
        let satisfiesPredicate: any;
        try {
          satisfiesPredicate = await predicate(either.value);
        } catch (error) {
          return new Failure<T, E2>(errorFn(either.value));
        }
        return satisfiesPredicate ? either : new Failure<T, E2>(errorFn(either.value));
      }),
    );
  }

  /**
   * Returns the value of the input monad if it is a success, otherwise throws the error.
   * Used to allow side effects outside of the monad. 
   * The returned monad will contain the same value as the input monad.
   * 
   * @param fn The function to execute
   * @returns {Monad<T, E>} A monad containing the value
   * 
   * @template E2 The type of the error
   * @example
   * const monad = Monad.of(1);
   * const value = monad.tap(value => console.log(value)); // value === 1
   * const monad = Monad.fail(new Error("Something went wrong"));
   * const value = monad.tap(value => console.log(value)); // value === an error
   */
  tap(fn: (value: T) => T | void | Promise<void>): Monad<T, E> {
    return new Monad(
      this.value.then(async (either) => {
        if (either.isSuccess()) {
          await Promise.resolve(fn(either.value));
        }
        return either;
      }),
    );
  }

  /**
   * Fold the value of the monad into a new value. If the value is a promise, it will be awaited.
   * If the value is a failure, the error will be propagated. If the mapping function throws an error,
   * 
   * @param onSuccess The function to execute if the monad is a success
   * @param onFailure The function to execute if the monad is a failure
   * @returns {Promise<FoldResult<U>>} A promise that resolves to the result of the fold operation, @see FoldResult
   * 
   * @template U The type of the result
   * @example
   * const monad = Monad.of(1);
   * const result = await monad.fold(value => value + 1, error => error.message); // result === 2
   * const monad = Monad.fail(new Error("Something went wrong"));
   * const result = await monad.fold(value => value + 1, error => error.message); // result === "Something went wrong"
   */
  async fold<U>(onSuccess: (value: T) => U, onFailure: (error: E) => U): Promise<FoldResult<U>> {
    try {
      const either = await this.yield();
      const result = either.isSuccess() ? onSuccess(either.value) : onFailure(either.error);
      return { result };
    } catch (error) {
      return { error };
    }
  }

  /**
   * Logs the value of the monad to the console. If the value is a promise, it will be awaited.
   * If the value is a failure, the error will be propagated. If the mapping function throws an error,
   * 
   * @param logger The logger to use, @default console
   * @param transformer A function that transforms the value of the monad into a log message, @default either => either.isSuccess() ? `Success: ${either.value}` : `Error: ${either.error}`
   * @returns {Monad<T, E>} A monad containing the value
   * 
   * @template L The type of the logger
   * @example
   * const monad = Monad.of(1);
   * const value = await monad.log(); // value === 1
   * const monad = Monad.fail(new Error("Something went wrong"));
   * const value = await monad.log(); // value === an error
   */
  log<L = Console>(
    logger?: L,
    transformer: (either: Either<T, E>) => any = (either) =>
      either.isSuccess() ? `Success: ${either.value}` : `Error: ${either.error}`,
  ): Monad<T, E> {
    return new Monad(
      this.value.then((either) => {
        // Pass the value to the logger if it has a log method
        if (logger && typeof (logger as any).log === "function") {
          (logger as any).log(transformer(either));
        } else {
          console.log(transformer(either));
        }
        return either;
      }),
    );
  }

  /**
   * Handles specific errors. If the value is a promise, it will be awaited.
   * 
   * @param errorTypes An array of error types to handle
   * @param handler A function that returns a monad
   * @returns {Monad<T, E>} A monad containing the value
   * 
   * @example
   * const monad = Monad.of(1);
   * const value = await monad.handleSpecificErrors([Error], error => Monad.of(2)); // value === 1
   */
  handleSpecificErrors(errorTypes: ErrorType[], handler: (error: E) => Monad<T, E>): Monad<T, E> {
    return new Monad(
      this.value.then((either) =>
        !either.isSuccess() && errorTypes.some((type) => either.error instanceof type)
          ? handler(either.error).yield()
          : either,
      ),
    );
  }

  /**
   * Handles http errors. If the value is a promise, it will be awaited.
   * 
   * @param statusCodes An array of status codes to handle
   * @param handler A function that returns a monad
   * @returns {Monad<T, E>} A monad containing the value
   * 
   * @example
   * const monad = Monad.of(1);
   * const value = await monad.handleHttpErrors([404], error => Monad.of(2)); // value === 1
   */
  handleHttpErrors(statusCodes: number[], handler: (error: HttpError) => Monad<T, E>): Monad<T, E> {
    return new Monad(
      this.value.then((either) =>
        !either.isSuccess() && either.error instanceof HttpError && statusCodes.includes(either.error.statusCode)
          ? handler(either.error).yield()
          : either,
      ),
    );
  }

  /**
   * Returns the value of the monad
   * @returns {Promise<Either<T, E>>} A promise that resolves to the value of the monad
   * @example
   * const monad = Monad.of(1);
   * const value = await monad.yield(); // value === 1
   */
  yield(): Promise<Either<T, E>> {
    return this.value;
  }
}
