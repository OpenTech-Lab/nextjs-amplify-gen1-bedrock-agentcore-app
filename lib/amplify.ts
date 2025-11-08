import { Amplify } from "aws-amplify";
import outputs from "@/src/amplifyconfiguration.json";

Amplify.configure(outputs);
