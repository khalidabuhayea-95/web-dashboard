#!/usr/bin/env node
/**
 * Quick test to verify logger.child() functionality
 */

// Import the logger 
import { logger, createLogger } from './src/lib/logging/logger.ts';

console.log('\n✓ Testing logger.child() compatibility...\n');

// Test 1: Default logger with child
const childLogger = logger.child({ requestId: 'test-123', userId: 'user-456' });
console.log('✓ logger.child() created successfully');

// Test 2: Child logger info method
childLogger.info('Test message with child context', { path: '/api/test' });
console.log('✓ child logger.info() works');

// Test 3: Child logger error method  
childLogger.error('Test error', new Error('test error'), { context: 'value' });
console.log('✓ child logger.error() works');

// Test 4: Scoped logger with child
const scopedLogger = createLogger('test.module');
const scopedChild = scopedLogger.child({ requestId: 'req-789' });
console.log('✓ scoped logger.child() created successfully');

// Test 5: Scoped child logger method
scopedChild.info('Scoped child message', { extra: 'data' });
console.log('✓ scoped child logger.info() works');

console.log('\n✓✓✓ All logger.child() tests passed! ✓✓✓\n');
