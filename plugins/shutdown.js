'use strict';

const Joi = require('@hapi/joi');
const logger = require('screwdriver-logger');

const tasks = {};
const taskSchema = Joi.object({
    taskname: Joi.string().required(),
    task: Joi.func().required(),
    timeout: Joi.number().integer()
});

/**
 * Function to return promise timeout or resolution
 * whichever happens first
 * @param {function} fn
 * @param {string} timeout
 */
function promiseTimeout(fn, timeout) {
    return Promise.race([
        Promise.resolve(fn),
        new Promise(resolve => {
            setTimeout(() => {
                resolve(`Promise timed out after ${timeout} ms`);
            }, timeout);
        })
    ]);
}

/**
 * Hapi plugin to handle serve graceful shutdown
 * @method register
 * @param  {Hapi.Server}    server
 */
const shutdownPlugin = {
    name: 'shutdown',
    async register(server) {
        const terminationGracePeriod = parseInt(process.env.TERMINATION_GRACE_PERIOD, 10) || 30;

        const taskHandler = async () => {
            try {
                await Promise.all(
                    Object.keys(tasks).map(async key => {
                        logger.info(`executing task ${key}`);
                        const item = tasks[key];

                        await item.task();
                    })
                );

                return Promise.resolve();
            } catch (err) {
                logger.error(err);
                throw err;
            }
        };

        const gracefulStop = async () => {
            try {
                logger.info('gracefully shutting down server');
                await server.stop({
                    timeout: 5000
                });
                process.exit(0);
            } catch (err) {
                logger.error(err);
                process.exit(1);
            }
        };

        const onSigterm = async () => {
            try {
                logger.info('got SIGTERM; running triggers before shutdown');
                const res = await promiseTimeout(taskHandler(), terminationGracePeriod * 1000);

                if (res) {
                    logger.error(res);
                }
                await gracefulStop();
            } catch (err) {
                logger.error('Error in plugin', err);
                process.exit(1);
            }
        };

        // catch sigterm signal
        process.on('SIGTERM', onSigterm);

        server.expose('handler', task => {
            const res = taskSchema.validate(task);

            if (res.error) {
                return res.error;
            }
            tasks[task.taskname] = task;

            return '';
        });
    }
};

module.exports = shutdownPlugin;