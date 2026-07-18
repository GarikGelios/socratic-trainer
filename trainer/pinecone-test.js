// Pinecone Connection Test
// Tests connection to your Pinecone index and shows stats
//
// Setup:
//   Add your API keys to .env file in project root
//
// Run:
//   node trainer/pinecone-test.js

require('dotenv').config();
const { Pinecone } = require('@pinecone-database/pinecone');

const INDEX_NAME = 'ba-training';

async function main() {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) {
    console.error('❌ PINECONE_API_KEY environment variable is not set.');
    console.error('   Run: $env:PINECONE_API_KEY="your-api-key-here"');
    process.exit(1);
  }

  console.log('🔌 Connecting to Pinecone...');
  const pc = new Pinecone({ apiKey });

  // List available indexes
  const { indexes } = await pc.listIndexes();
  console.log(`\n📋 Available indexes: ${indexes.map(i => i.name).join(', ') || '(none)'}`);

  // Check if target index exists
  const target = indexes.find(i => i.name === INDEX_NAME);
  if (!target) {
    console.error(`\n❌ Index "${INDEX_NAME}" not found.`);
    process.exit(1);
  }

  console.log(`\n✅ Index "${INDEX_NAME}" found:`);
  console.log(`   Dimension: ${target.dimension}`);
  console.log(`   Metric:    ${target.metric}`);
  console.log(`   Host:      ${target.host}`);

  // Get index stats
  const index = pc.index(INDEX_NAME);
  const stats = await index.describeIndexStats();
  console.log(`\n📊 Index Stats:`);
  console.log(`   Total vectors:   ${stats.totalRecordCount}`);
  console.log(`   Namespaces:      ${Object.keys(stats.namespaces || {}).length}`);

  if (stats.namespaces) {
    Object.entries(stats.namespaces).forEach(([ns, data]) => {
      const label = ns === '' ? '(default)' : ns;
      console.log(`     • ${label}: ${data.recordCount} vectors`);
    });
  }

  console.log('\n✅ Connection successful!');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
