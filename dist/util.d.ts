import { Monad } from "./monad";
/**
 * A class representing a successful value
 * @class Success
 * @param {T} value The value
 *
 * @template T The type of the value
 * @template E The type of the error
 */
declare class Success<T, E> {
    value: T;
    constructor(value: T);
    /**
     * Returns true if the value is a success
     *
     * @returns {boolean} true if the value is a success
     */
    isSuccess(): this is Success<T, E>;
}
/**
 * A class representing a failed value
 * @class Failure
 * @param {T} value The value
 *
 * @template T The type of the value
 * @template E The type of the error
 */
declare class Failure<T, E> {
    error: E;
    constructor(error: E);
    /**
     * Returns true if the value is a failure
     *
     * @returns {boolean} true if the value is a failure
     */
    isSuccess(): this is Success<T, E>;
}
/**
 * A type representing a value that can be either a success or a failure
 * @type Either
 * @param {T} value The value
 *
 * @template T The type of the value
 * @template E The type of the error
 */
type Either<T, E> = Success<T, E> | Failure<T, E>;
/**
 * A type representing a match condition
 * @type MatchCondition
 * @param {T} value The value
 *
 * @template T The type of the value
 * @template E The type of the error
 */
type MatchCondition<T, E> = {
    /**
     * The condition
     *
     * @param value the value
     * @returns {boolean} true if the condition is met
     */
    condition: (value: T) => boolean;
    /**
     * The action to perform if the condition is met
     *
     * @param value the value
     * @returns {T | E | Promise<T | E>} the action
     */
    action: (value: T) => T | E | Promise<T | E>;
};
/**
 * A type representing a match mode
 * @type MatchMode
 * @param {FIRST} FIRST match the first condition
 * @param {EVERY} EVERY match every condition
 */
declare enum MatchMode {
    FIRST = 0,
    EVERY = 1
}
/**
 * A type representing match options
 * @type MatchOptions
 * @param {continueIfNoMatch} continueIfNoMatch continue if no match is found
 * @param {continueOnError} continueOnError continue if an error is thrown
 * @param {mode} mode the match mode
 */
type MatchOptions = {
    continueIfNoMatch?: boolean;
    continueOnError?: boolean;
    mode?: MatchMode;
};
/**
 * A type representing a named monad
 * @type NamedMonad
 * @param {monad} monad the monad
 * @param {name} name the name of the monad
 *
 * @template T The type of the value
 * @template E The type of the error
 */
type NamedMonad<T, E = Error> = {
    monad: Monad<T, E>;
    name?: string;
};
/**
 * A type representing retry options
 * @type RetryOptions
 * @param {times} times the number of times to retry
 * @param {delay} delay the delay between retries
 * @param {backoffFactor} backoffFactor the backoff factor
 * @param {onError} onError the error handler
 *
 * @template E The type of the error
 */
type RetryOptions<E> = {
    times: number;
    delay: number;
    backoffFactor?: number;
    onError?: (error: E, attempt: number) => void;
};
/**
 * A type representing a fold result
 * @type FoldResult
 * @param {result} result the result
 * @param {error} error the error
 *
 * @template U The type of the result
 */
type FoldResult<U, E = Error> = {
    result?: U;
    error?: E;
};
/**
 * A type representing an error type
 * @type ErrorType
 * @param {args} args the error arguments
 */
type ErrorType = new (...args: any[]) => Error;
/**
 * A class representing an HTTP error
 * @class HttpError
 * @param {statusCode} statusCode the status code
 * @param {message} message the error message
 */
declare class HttpError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string);
}
export { Either, Success, Failure, MatchCondition, MatchMode, MatchOptions, NamedMonad, RetryOptions, FoldResult, ErrorType, HttpError, };
//# sourceMappingURL=util.d.ts.map