# Use node:18-alpine as the base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package.json ./
RUN npm install

# Copy the rest of the application files
COPY . .

# Expose port 80
EXPOSE 80

# Start the Node.js server
CMD ["npm", "start"]

