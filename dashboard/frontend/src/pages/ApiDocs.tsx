import { Link } from 'react-router-dom';
import { ArrowLeft, Book, Code, Globe, Terminal } from 'lucide-react';
import PageHeader from '../components/PageHeader';

export default function ApiDocs() {
  const curlExample = `
# List all instances
curl -X GET http://localhost:3000/api/instances \\
  -H "X-API-Key: mb_1234567890abcdef12345678"
`;

  const nodeExample = `
const axios = require('axios');

const client = axios.create({
  baseURL: 'http://localhost:3000/api',
  headers: {
    'X-API-Key': 'mb_1234567890abcdef12345678'
  }
});

// List instances
async function listInstances() {
  try {
    const { data } = await client.get('/instances');
    console.log('Instances:', data);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

listInstances();
`;

  const pythonExample = `
import requests

API_KEY = 'mb_1234567890abcdef12345678'
BASE_URL = 'http://localhost:3000/api'

headers = {
    'X-API-Key': API_KEY
}

def list_instances():
    try:
        response = requests.get(f'{BASE_URL}/instances', headers=headers)
        response.raise_for_status()
        print('Instances:', response.json())
    except requests.exceptions.RequestException as e:
        print('Error:', e)

if __name__ == '__main__':
    list_instances()
`;

  return (
    <div className='min-h-screen bg-background'>
      <PageHeader>
        <div className='flex items-center justify-between'>
          <div>
            <Link
              to='/api-keys'
              className='inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-2'
            >
              <ArrowLeft className='w-4 h-4' />
              Back to API Keys
            </Link>
            <h2 className='text-2xl font-bold text-foreground flex items-center gap-2'>
              <Book className='w-6 h-6' />
              API Documentation
            </h2>
            <p className='text-muted-foreground mt-1'>How to authenticate and communicate with the Multibase API.</p>
          </div>
        </div>
      </PageHeader>

      <main className='container mx-auto px-6 py-8'>
        <div className='grid grid-cols-1 lg:grid-cols-3 gap-8'>
          <div className='lg:col-span-2 space-y-8'>
            <section className='bg-card border rounded-lg p-6'>
              <h3 className='text-xl font-bold mb-4 flex items-center gap-2'>
                <Globe className='w-5 h-5 text-primary' />
                Authentication
              </h3>
              <p className='text-muted-foreground mb-4'>
                Multibase supports API Key authentication via HTTP Headers. Include your API Key in the
                <code className='bg-muted px-1 py-0.5 rounded mx-1 text-foreground'>X-API-Key</code>
                header of every request.
              </p>

              <div className='bg-secondary/50 p-4 rounded-md border border-border'>
                <h4 className='font-medium text-foreground mb-2'>Important Notes:</h4>
                <ul className='list-disc list-inside text-sm text-muted-foreground space-y-1'>
                  <li>API Keys grant full access to your account and instances.</li>
                  <li>Keep your keys secure and never share them publicly.</li>
                  <li>If a key is compromised, revoke it immediately in the dashboard.</li>
                  <li>
                    Requests without a valid key (or session cookie) will return{' '}
                    <code className='text-destructive'>401 Unauthorized</code>.
                  </li>
                </ul>
              </div>
            </section>

            <section className='bg-card border rounded-lg p-6'>
              <h3 className='text-xl font-bold mb-4 flex items-center gap-2'>
                <Terminal className='w-5 h-5 text-primary' />
                Examples
              </h3>

              <div className='mb-6'>
                <h4 className='font-medium text-foreground mb-2'>cURL / Shell</h4>
                <pre className='bg-muted p-4 rounded-md overflow-x-auto border border-border'>
                  <code className='text-sm font-mono text-foreground'>{curlExample.trim()}</code>
                </pre>
              </div>

              <div className='mb-6'>
                <h4 className='font-medium text-foreground mb-2'>Node.js (Axios)</h4>
                <pre className='bg-muted p-4 rounded-md overflow-x-auto border border-border'>
                  <code className='text-sm font-mono text-foreground'>{nodeExample.trim()}</code>
                </pre>
              </div>

              <div>
                <h4 className='font-medium text-foreground mb-2'>Python (Requests)</h4>
                <pre className='bg-muted p-4 rounded-md overflow-x-auto border border-border'>
                  <code className='text-sm font-mono text-foreground'>{pythonExample.trim()}</code>
                </pre>
              </div>
            </section>
          </div>

          <div className='space-y-6'>
            <div className='bg-card border rounded-lg p-6 sticky top-6'>
              <h3 className='font-bold mb-4 flex items-center gap-2'>
                <Code className='w-5 h-5' />
                Common Endpoints
              </h3>
              <ul className='space-y-4 text-sm'>
                <li>
                  <div className='font-mono font-medium text-foreground flex items-center gap-2'>
                    <span className='px-2 py-0.5 rounded bg-blue-500/10 text-blue-500'>GET</span>
                    /api/instances
                  </div>
                  <p className='text-muted-foreground mt-1'>List all provisioned instances.</p>
                </li>
                <li>
                  <div className='font-mono font-medium text-foreground flex items-center gap-2'>
                    <span className='px-2 py-0.5 rounded bg-green-500/10 text-green-500'>POST</span>
                    /api/instances
                  </div>
                  <p className='text-muted-foreground mt-1'>Create a new Supabase instance.</p>
                </li>
                <li>
                  <div className='font-mono font-medium text-foreground flex items-center gap-2'>
                    <span className='px-2 py-0.5 rounded bg-red-500/10 text-red-500'>DEL</span>
                    /api/instances/:id
                  </div>
                  <p className='text-muted-foreground mt-1'>Delete an instance.</p>
                </li>
                <li>
                  <div className='font-mono font-medium text-foreground flex items-center gap-2'>
                    <span className='px-2 py-0.5 rounded bg-blue-500/10 text-blue-500'>GET</span>
                    /api/backups
                  </div>
                  <p className='text-muted-foreground mt-1'>List available backups.</p>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
