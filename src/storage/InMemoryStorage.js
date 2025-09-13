
/**
 * In-Memory Storage Service - Simple alternative to PostgreSQL for testing
 */

const EventEmitter = require('events');
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

class InMemoryStorage extends EventEmitter {
  constructor() {
    super();
    
    // In-memory data stores
    this.events = new Map();
    this.alerts = new Map();
    this.metrics = [];
    this.robotStates = new Map();
    this.zones = new Map();
    this.configurations = new Map();
