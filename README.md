# Next.js Amplify Gen 1 Bedrock Agentcore App

This is a full-stack web application built with Next.js, Tailwind CSS, shadcn/ui components, and AWS Amplify Gen 1. It integrates Amazon Bedrock Agentcore for AI-powered chat functionality, enabling a knowledge sharing platform with intelligent conversational agents.

## Tech Stack

- **Frontend**: Next.js 15, React, TypeScript
- **Styling**: Tailwind CSS, shadcn/ui component library
- **Backend**: AWS Amplify Gen 1 (API Gateway, Lambda Functions, Cognito Authentication)
- **AI/ML**: Amazon Bedrock Agentcore (Python-based agent)
- **Hosting**: AWS S3 and CloudFront via Amplify
- **Database**: AWS services through Amplify (DynamoDB, etc.)

## Features

- 🔐 User authentication and authorization with AWS Cognito
- 💬 AI-powered chat interface using Bedrock Agentcore
- 📚 Knowledge sharing platform
- 🎨 Modern, responsive UI with shadcn/ui components
- ☁️ Serverless backend with AWS Lambda
- 🚀 Static site hosting on S3/CloudFront
- 🔄 Real-time updates with Server-Sent Events (SSE)

## Project Structure

```
├── app/                    # Next.js app directory
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Home page
├── components/            # React components
│   ├── ui/               # shadcn/ui components
│   ├── AuthProvider.tsx  # Authentication provider
│   ├── ChatComponent.tsx # Chat interface
│   ├── Header.tsx        # App header
│   └── Sidebar.tsx       # Navigation sidebar
├── hooks/                # Custom React hooks
├── lib/                  # Utility libraries
├── amplify/              # AWS Amplify configuration
│   ├── backend/          # Backend resources
│   ├── #current-cloud-backend/  # Current deployment state
│   └── team-provider-info.json
├── agentcore/            # Amazon Bedrock Agentcore
│   ├── my_agent.py       # Python agent implementation
│   └── requirements.txt  # Python dependencies
├── public/               # Static assets
└── src/                  # Additional source files
    └── amplifyconfiguration.json
```

## Prerequisites

- Node.js (v18 or later)
- npm or yarn
- AWS CLI configured with appropriate permissions
- Python 3.8+ (for Agentcore)
- Amplify CLI installed globally

## Installation

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd nextjs-amplify-gen1-bedrock-agentcore-app
   ```

2. **Install frontend dependencies**

   ```bash
   npm install
   ```

3. **Set up AWS Amplify**

   ```bash
   amplify init
   amplify pull
   ```

4. **Configure Agentcore**

   ```bash
   cd agentcore
   pip install -r requirements.txt
   ```

5. **Environment Configuration**
   - Copy `.env.example` to `.env.local` and fill in required values
   - Ensure AWS credentials are configured

## Usage

### Development

1. **Start the development server**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) in your browser.

2. **Run the Agentcore locally** (if needed)
   ```bash
   cd agentcore
   python my_agent.py
   ```

### Building

```bash
npm run build
```

### Testing

```bash
npm test
```

## Deployment

1. **Deploy to AWS Amplify**

   ```bash
   rm amplify-old
   mv amplify amplify-old
   amplify init
   amplify add auth
   amplify add hosting
   amplify add api

   amplify push
   amplify publish
   ```

2. **Deploy Bedrock Agentcore**

   ```
   agentcore configure --entrypoint my_agent.py
   agentcore launch
   ```

3. **Monitor and manage**
   - Use AWS Console to monitor Lambda functions, API Gateway, etc.
   - Check Amplify Console for hosting status

## API Endpoints

- `/api/chat` - Chat API endpoint (handled by Lambda function)
- Authentication endpoints via AWS Cognito

## Configuration

### Amplify Configuration

- API: REST API via API Gateway
- Auth: Amazon Cognito User Pool
- Hosting: S3 and CloudFront
- Functions: Node.js Lambda functions

### Bedrock Agentcore

- Python-based agent for AI interactions
- Configured in `agentcore/my_agent.py`

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Next.js](https://nextjs.org/) - The React framework
- [AWS Amplify](https://aws.amazon.com/amplify/) - Backend and hosting
- [Amazon Bedrock](https://aws.amazon.com/bedrock/) - AI/ML services
- [shadcn/ui](https://ui.shadcn.com/) - UI component library
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS framework
